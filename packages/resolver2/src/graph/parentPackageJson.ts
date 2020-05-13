import { PackageJson } from '../util/packageJson';
import { Uri } from '../util/uri';

export type ParentPackageJson = {
  packageJson: PackageJson;
  uri: Uri;
};
