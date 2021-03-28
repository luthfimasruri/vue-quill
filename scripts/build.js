/*
Produces production builds and stitches together d.ts files.

To specify the package to build, simply pass its name and the desired build
formats to output (defaults to `buildOptions.formats` specified in that package,
or "esm,cjs"):

```
# name supports fuzzy match. will build all packages with name containing "dom":
npm run build -- vue-quill

# specify the format to output
npm run build -- vue-quill --formats cjs
```
*/

const fs = require('fs-extra')
const path = require('path')
const execa = require('execa')
const { buildTypes } = require('./build-types')
const { buildAssets } = require('./build-assets')
const {
  targets: allTargets,
  fuzzyMatchTarget,
  checkBuildSize,
  runParallel,
} = require('./utils')

const args = require('minimist')(process.argv.slice(2))
const targets = args._
const formats = args.formats || args.f
const devOnly = args.devOnly || args.d
const prodOnly = !devOnly && (args.prodOnly || args.p)
const sourceMap = args.sourcemap || args.s
const isRelease = args.release || (args.nextVersion && args.nextVersion !== '')
const hasTypes = args.t || args.types || isRelease
const hasAssets = args.assets || isRelease
const buildAllMatching = args.all || args.a
const nextVersion =
  args.nextVersion ||
  require(path.resolve(__dirname, '..', 'package.json')).version
const commit =
  args.commit || execa.sync('git', ['rev-parse', 'HEAD']).stdout.slice(0, 7)

run()

async function run() {
  if (isRelease) {
    // remove build cache for release builds to avoid outdated enum values
    await fs.remove(path.resolve(__dirname, '../node_modules/.rts2_cache'))
  }
  if (!targets.length) {
    await buildAll(allTargets)
    checkAllSizes(allTargets)
  } else {
    await buildAll(fuzzyMatchTarget(targets, buildAllMatching, allTargets))
    checkAllSizes(fuzzyMatchTarget(targets, buildAllMatching, allTargets))
  }
}

async function buildAll(targets) {
  await runParallel(require('os').cpus().length, targets, build)
}

async function build(target) {
  const pkgDir = path.resolve(__dirname, `../packages/${target}`)
  const pkg = require(path.resolve(pkgDir, 'package.json'))
  const assetsConfig = require(path.resolve(pkgDir, 'assets.config.json'))

  // only build published packages for release
  if (isRelease && pkg.private) return

  // if building a specific format, do not remove dist.
  if (!formats) await fs.remove(`${pkgDir}/dist`)

  const env =
    (pkg.buildOptions && pkg.buildOptions.env) ||
    (devOnly ? 'development' : 'production')
  await execa(
    'rollup',
    [
      '-c',
      '--environment',
      [
        `COMMIT:${commit}`,
        `NODE_ENV:${env}`,
        `TARGET:${target}`,
        formats ? `FORMATS:${formats}` : ``,
        hasTypes ? `TYPES:true` : ``,
        prodOnly ? `PROD_ONLY:true` : ``,
        sourceMap ? `SOURCE_MAP:true` : ``,
        nextVersion ? `NEXT_VERSION:${nextVersion}` : ``,
      ]
        .filter(Boolean)
        .join(','),
    ],
    { stdio: 'inherit' }
  )

  if (hasTypes && pkg.types) buildTypes(target)
  if (hasAssets && assetsConfig.css) buildAssets(target)
}

function checkAllSizes(targets) {
  if (devOnly) return
  console.log()
  for (const target of targets) checkBuildSize(target)
  console.log()
}