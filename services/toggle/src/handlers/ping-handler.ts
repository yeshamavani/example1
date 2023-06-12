import {injectable} from '@loopback/context';
import {FeatureHandler, asFeatureHandler} from '@sourceloop/feature-toggle';

@injectable(asFeatureHandler)
export class PingHandler implements FeatureHandler {
  handlerName = 'ping';

  handle(): void {
    console.log('in the handler');
  }
}
