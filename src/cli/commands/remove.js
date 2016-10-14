/* @flow */

import type {Reporter} from '../../reporters/index.js';
import type Config from '../../config.js';
import {execFromManifest} from './_execute-lifecycle-script.js';
import Lockfile from '../../lockfile/wrapper.js';
import {registries} from '../../registries/index.js';
import {Install} from './install.js';
import {MessageError} from '../../errors.js';
import {NoopReporter} from '../../reporters/index.js';
import * as fs from '../../util/fs.js';
import * as constants from '../../constants.js';

const path = require('path');

export const requireLockfile = true;

export async function run(
  config: Config,
  reporter: Reporter,
  flags: Object,
  args: Array<string>,
): Promise<void> {
  if (!args.length) {
    throw new MessageError(reporter.lang('tooFewArguments', 1));
  }

  // load manifests
  const lockfile = await Lockfile.fromDirectory(config.cwd);
  const install = new Install(flags, config, new NoopReporter(), lockfile);
  const rootManifests = await install.getRootManifests();
  let manifests = [];
  let modules: Array<string> = [];

  if (args.length === 1 && args[0] == '*') {

    //get list of dependencies

    for (const registryName of Object.keys(registries)) {
      const object = rootManifests[registryName].object;

      for (const type of constants.DEPENDENCY_TYPES) {
        const deps = object[type];	

        if (deps && Object.keys(deps).length) {
          modules = modules.concat(Object.keys(deps));
          console.log(modules);
        }
      }
    
    }
  } else {
    modules = args;
  }

  if (!modules.length) {
    throw new MessageError(reporter.lang('moduleNotInManifest'));
  }

  manifests = await removeModules(config, reporter, rootManifests, modules);

  // save manifests
  await install.saveRootManifests(rootManifests);

  // run hooks - npm runs these one after another
  for (const action of ['preuninstall', 'uninstall', 'postuninstall']) {
    for (const [loc, manifest] of manifests) {
      await execFromManifest(config, action, manifest, loc);
    }
  }

  // reinstall so we can get the updated lockfile
  reporter.step(modules.length + 1, modules.length + 1, reporter.lang('uninstallRegenerate'));
  const reinstall = new Install({force: true, ...flags}, config, new NoopReporter(), lockfile);
  await reinstall.init();

  //
  reporter.success(reporter.lang('uninstalledPackages'));
}

async function removeModules(
  config: Config,
  reporter: Reporter,
  rootManifests: any,
  moduleNames: Array<string>,
): Promise<Array<any>> {

  const manifests = [];
  let step = 0;

  for (const name of moduleNames) {
    reporter.step(++step, moduleNames.length + 1, `Removing module ${name}`);

    let found = false;

    for (const registryName of Object.keys(registries)) {
      const registry = config.registries[registryName];
      const object = rootManifests[registryName].object;

      for (const type of constants.DEPENDENCY_TYPES) {
        const deps = object[type];
        if (deps) {
          found = true;
          delete deps[name];
        }
      }

      const possibleManifestLoc = path.join(config.cwd, registry.folder, name);
      if (await fs.exists(possibleManifestLoc)) {
        manifests.push([
          possibleManifestLoc,
          await config.readManifest(possibleManifestLoc, registryName),
        ]);
      }
    }

    if (!found) {
      throw new MessageError(reporter.lang('moduleNotInManifest'));
    }
  }

  return manifests;
}
