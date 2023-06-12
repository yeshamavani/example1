import {Getter, Provider, inject} from '@loopback/core';
import {AnyObject, repository} from '@loopback/repository';
import {HttpErrors} from '@loopback/rest';
import {
  AuthorizationBindings,
  JwtPayloadFn,
  RoleRepository,
  TenantConfigRepository,
  User,
  UserLevelPermissionRepository,
  UserTenant,
  UserTenantRepository,
} from '@sourceloop/authentication-service';
import {
  AuthenticateErrorKeys,
  ConfigKey,
  ILogger,
  LOGGER,
  getAge,
} from '@sourceloop/core';
import {AuthErrorKeys, IAuthClient, IAuthUser} from 'loopback4-authentication';
import {UserPermissionsFn} from 'loopback4-authorization';
import {FeatureToggleRepository} from '@sourceloop/feature-toggle-service';

export class MyJwtPayloadProvider implements Provider<JwtPayloadFn> {
  constructor(
    @repository(RoleRepository)
    private readonly roleRepo: RoleRepository,
    @repository(UserLevelPermissionRepository)
    private readonly utPermsRepo: UserLevelPermissionRepository,
    @repository(UserTenantRepository)
    private readonly userTenantRepo: UserTenantRepository,
    @repository(TenantConfigRepository)
    private readonly tenantConfigRepo: TenantConfigRepository,
    @inject(AuthorizationBindings.USER_PERMISSIONS)
    private readonly getUserPermissions: UserPermissionsFn<string>,
    @inject(LOGGER.LOGGER_INJECT) private readonly logger: ILogger,
    @repository.getter('FeatureToggleRepository')
    public getFeatureToggleRepository: Getter<FeatureToggleRepository>,
  ) {}

  value() {
    return async (
      authUserData: IAuthUser,
      authClient: IAuthClient,
      tenantId?: string,
    ) => {
      const user = authUserData as User;
      const userTenant = await this.userTenantRepo.findOne({
        where: {
          userId: (user as User).id, //NOSONAR
          tenantId: tenantId ?? user.defaultTenantId,
        },
      });

      if (!userTenant) {
        throw new HttpErrors.Unauthorized(
          AuthenticateErrorKeys.UserDoesNotExist,
        );
      }

      if (
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        user.authClientIds.indexOf(authClient.id || 0) < 0
      ) {
        throw new HttpErrors.Unauthorized(AuthErrorKeys.ClientInvalid);
      }
      delete user.authClientIds;

      // Create user DTO for payload to JWT
      const authUser: AnyObject = Object.assign({}, user);
      this._removeUnnecessaryData(authUser);

      // Add locale info
      await this._setLocale(authUser, userTenant);

      authUser.tenantId = userTenant.tenantId;
      authUser.userTenantId = userTenant.id;
      authUser.status = userTenant.status;
      const role = await this.roleRepo.findById(userTenant.roleId);
      if (!role) {
        this.logger.error('Role not found for the user');
        throw new HttpErrors.UnprocessableEntity(
          AuthenticateErrorKeys.UnprocessableData,
        );
      }

      const utPerms = await this.utPermsRepo.find({
        where: {
          userTenantId: userTenant.id,
        },
        fields: {
          permission: true,
          allowed: true,
        },
      });
      authUser.permissions = this.getUserPermissions(utPerms, role.permissions);
      authUser.role = role.name;
      if (authUser.dob) {
        const age = getAge(new Date(authUser.dob));
        authUser.age = age;
      }
      authUser.disabledFeatures = await this._getDisabledFeatures(authUser);
      return authUser;
    };
  }

  private async _getDisabledFeatures(authUser: AnyObject) {
    const disabledFeatures: string[] = [];

    const featureToggleRepository = await this.getFeatureToggleRepository();
    const disabledFeat = await featureToggleRepository.find({
      where: {
        and: [
          {
            or: [
              {strategyKey: 'System'}, //system level
              {strategyEntityId: authUser.tenantId}, //tenant level
              {strategyEntityId: authUser.userTenantId}, //user level
            ],
            status: false,
          },
        ],
      },
    });

    disabledFeat.forEach(feat => {
      disabledFeatures.push(feat.featureKey);
    });
    return disabledFeatures;
  }

  private _removeUnnecessaryData(authUser: AnyObject) {
    delete authUser.externalAuthToken;
    delete authUser.externalRefreshToken;
    delete authUser.createdBy;
    delete authUser.createdOn;
    delete authUser.deleted;
    delete authUser.deletedBy;
    delete authUser.deletedOn;
    delete authUser.modifiedBy;
    delete authUser.modifiedOn;
    return authUser;
  }

  private async _setLocale(authUser: AnyObject, userTenant: UserTenant) {
    if (userTenant.locale && userTenant.locale.length > 0) {
      // Use locale from user preferences first
      authUser.userPreferences = {locale: userTenant.locale};
    } else {
      // Use tenant config locale at second priority
      const config = await this.tenantConfigRepo.findOne({
        where: {
          configKey: ConfigKey.Profile,
        },
      });

      // Use locale from environment as fallback overall
      let locale = process.env.LOCALE ?? 'en';
      if (config?.configValue) {
        // sonarignore:start
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        locale = (config.configValue as any).locale;
        // sonarignore:end
      }
      authUser.userPreferences = {
        locale,
      };
    }
  }
}
