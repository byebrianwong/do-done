// Metro config for the do-done mobile app inside the pnpm monorepo.
//
// Pins `react` / `react-dom` to THIS app's copy (react@19.1.0, the version
// react-native 0.81 is built against). The monorepo's web app pins react@19.2.x,
// and without this pin Metro can resolve a second React into the native bundle
// for some transitive deps (e.g. react-native-draggable-flatlist), producing the
// runtime "Invalid hook call / more than one copy of React" crash.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

const reactRoot = path.resolve(projectRoot, 'node_modules/react');
const reactDomRoot = path.resolve(projectRoot, 'node_modules/react-dom');

config.resolver.resolveRequest = (context, moduleName, platform) => {
  let target = moduleName;
  if (moduleName === 'react' || moduleName.startsWith('react/')) {
    // 'react' -> reactRoot, 'react/jsx-runtime' -> reactRoot + '/jsx-runtime'
    target = reactRoot + moduleName.slice('react'.length);
  } else if (moduleName === 'react-dom' || moduleName.startsWith('react-dom/')) {
    target = reactDomRoot + moduleName.slice('react-dom'.length);
  }
  return context.resolveRequest(context, target, platform);
};

module.exports = config;
