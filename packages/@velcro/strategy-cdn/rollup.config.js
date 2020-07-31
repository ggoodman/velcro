import { rollupConfigFactory } from '../../../rollup.config.factory';
import * as PackageJson from './package.json';

export default rollupConfigFactory(__dirname, PackageJson);
