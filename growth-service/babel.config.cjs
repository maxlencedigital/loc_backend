// Used ONLY by Jest to transpile TS -> CJS for tests. The app itself
// runs via tsx (dev) / tsc (build) — this file has no effect on those.
module.exports = {
  presets: [
    ["@babel/preset-env", { targets: { node: "current" } }],
    // allowDeclareFields is required for Sequelize model classes, which use
    // `declare id: string` to describe columns without emitting a field that
    // would shadow Sequelize's own getters. Without it Babel throws on any
    // test that transitively imports a model.
    ["@babel/preset-typescript", { allowDeclareFields: true }],
  ],
};
