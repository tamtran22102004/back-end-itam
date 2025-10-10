// utils/wrap.js
const wrap = (fn) => {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

module.exports = wrap;
