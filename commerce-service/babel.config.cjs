// Used ONLY by Jest to transpile TS -> CJS for tests. The app itself
// runs via tsx (dev) / tsc (build) — this file has no effect on those.
module.exports = {
  presets: [
    ["@babel/preset-env", { targets: { node: "current" } }],
    "@babel/preset-typescript",
  ],
};
