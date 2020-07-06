module.exports = () => {
  if (typeof document !== 'undefined') {
    document.getElementsByTagName('html')[0].innerHTML = '';
  }
};
