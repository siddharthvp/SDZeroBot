module.exports = {
    ignore: [
        "node_modules/**/*.ts",
        "**/*.d.ts"
    ],
    "presets": ["@babel/preset-typescript"],
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
