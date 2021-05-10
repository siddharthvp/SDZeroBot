// Install the npm deps @babel/cli @babel/core
// and all the @babel packages mentioned in the config below
// Generate build via
//      babel . --extensions ".ts" --out-dir .

module.exports = {
    ignore: [
        "node_modules/**/*.ts",
        "**/*.d.ts"
    ],
    "presets": ["@babel/preset-env", "@babel/preset-typescript"],
    "plugins": [
        [
            "@babel/plugin-transform-modules-commonjs",
            {
                loose: true,
                noInterop: true
            }
        ]
    ]
}
