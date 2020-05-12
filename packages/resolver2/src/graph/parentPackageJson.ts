import { PackageJson } from '../packageJson';
import { Uri } from '../uri';

export type ParentPackageJson = {
  packageJson: PackageJson;
  uri: Uri;
};
