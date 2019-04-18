var posixPath = require('./path_posix');

module.exports = Object.assign(posixPath, {
  posix: posixPath,
  win32: posixPath,
});
