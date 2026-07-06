import {join} from 'path';
import {ProxyDB} from '../db/proxy';
import {WindowDB} from '../db/window';
// import {getChromePath} from './device';
import {BrowserWindow} from 'electron';
import puppeteer from 'puppeteer';
import {execSync, spawn} from 'child_process';
import * as portscanner from 'portscanner';
import {sleep} from '../utils/sleep';
import SocksServer from '../proxy-server/socks-server';
import type {DB} from '../../../shared/types/db';
import {type IncomingMessage, type Server, type ServerResponse} from 'http';
import {createLogger} from '../../../shared/utils/logger';
import {WINDOW_LOGGER_LABEL} from '../constants';
import {db} from '../db';
import {getProxyInfo} from './prepare';
import * as ProxyChain from 'proxy-chain';
import {ensureProfileCachePath, getSettings} from '../utils/get-settings';
import {MANAGED_CHROMIUM_VERSION, resolveManagedBrowserCore} from '../browser-core/managed-core';
// import {randomFingerprint} from '../services/window-service';
import {bridgeMessageToUI, getClientPort, getMainWindow} from '../mainWindow';
import {Mutex} from 'async-mutex';
// import {presetCookie} from '../puppeteer/helpers';
import api from '../../../shared/api/api';
import {ExtensionDB} from '../db/extension';
import {getPort} from '../server';
import type {SettingOptions} from '../../../shared/types/common';
import {buildBrowserLaunchParameters} from './launch-params';
import {stopFingerprintCdpSession} from './cdp';
import {serializeFingerprintSnapshot} from './snapshot';
import {ensureManagedProfileDirectory} from '../profile/storage';

const mutex = new Mutex();

const logger = createLogger(WINDOW_LOGGER_LABEL);

const HOST = '127.0.0.1';

// async function connectBrowser(
//   port: number,
//   ipInfo: IP,
//   windowId: number,
//   openStartPage: boolean = true,
// ) {
//   // const windowData = await WindowDB.getById(windowId);
//   const settings = getSettings();
//   const browserURL = `http://${HOST}:${port}`;
//   const {data} = await api.get(browserURL + '/json/version');
//   if (data.webSocketDebuggerUrl) {
//     const browser = await puppeteer.connect({
//       browserWSEndpoint: data.webSocketDebuggerUrl,
//       defaultViewport: null,
//     });

//     // if (!windowData.opened_at) {
//     //   await presetCookie(windowId, browser);
//     // }
//     await WindowDB.update(windowId, {
//       status: 2,
//       port: port,
//       opened_at: db.fn.now() as unknown as string,
//     });

//     browser.on('targetcreated', async target => {
//       const newPage = await target.page();
//       if (newPage) {
//         await newPage.waitForNavigation({waitUntil: 'networkidle0'});
//         if (!settings.useLocalChrome) {
//           await modifyPageInfo(windowId, newPage, ipInfo);
//         }
//       }
//     });
//     const pages = await browser.pages();
//     const page =
//       pages.length &&
//       (pages?.[0]?.url() === 'about:blank' ||
//         !pages?.[0]?.url() ||
//         pages?.[0]?.url() === 'chrome://new-tab-page/')
//         ? pages?.[0]
//         : await browser.newPage();
//     try {
//       if (!settings.useLocalChrome) {
//         await modifyPageInfo(windowId, page, ipInfo);
//       }
//       if (getClientPort() && openStartPage) {
//         await page.goto(
//           `http://localhost:${getClientPort()}/#/start?windowId=${windowId}&serverPort=${getPort()}`,
//         );
//       }
//     } catch (error) {
//       logger.error(error);
//     }
//     return data;
//   }
// }

const getBrowserLaunchTarget = (settings: SettingOptions) => {
  if (settings.browserMode === 'managed') {
    const managedCore = resolveManagedBrowserCore({
      rootPath: settings.managedBrowserRoot,
      manifestPath: settings.managedBrowserManifestPath,
      verifyHash: true,
      verifyVersion: true,
    });
    return {
      driverPath: managedCore.executablePath,
      profileDirectorySegments: ['managed-chromium', MANAGED_CHROMIUM_VERSION],
      managed: true,
    };
  }

  return {
    driverPath: settings.localChromePath || settings.chromiumBinPath,
    profileDirectorySegments: ['chrome'],
    managed: false,
  };
};

const getAvailablePort = async () => {
  for (let attempts = 0; attempts < 10; attempts++) {
    try {
      const port = await portscanner.findAPortNotInUse(9222, 40222);
      return port; // 成功绑定后返回
    } catch (error) {
      console.log('Port already in use, retrying...');
    }
  }
  throw new Error('Failed to find a free port after multiple attempts');
};

const waitForChromeReady = async (chromePort: number, id: number, maxAttempts = 30) => {
  let attempts = 0;

  while (attempts < maxAttempts) {
    try {
      // 尝试连接 CDP
      const response = await api.get(`http://${HOST}:${chromePort}/json/version`, {
        timeout: 1000,
      });
      if (response.status === 200) {
        return true;
      }
    } catch (error) {
      logger.error('连接失败', (error as Error).message);
      // 连接失败，继续等待
    }

    attempts++;
    await sleep(0.5);
  }

  throw new Error('Chrome instance failed to start within the timeout period');
};

export async function openFingerprintWindow(id: number, headless = false) {
  const release = await mutex.acquire();
  try {
    const windowData = await WindowDB.getById(id);
    
    // 检查窗口是否已经打开
    if (windowData.status === 2 && windowData.port) {
      logger.info(`Window ${id} is already running on port ${windowData.port}`);
      try {
        const browserURL = `http://${HOST}:${windowData.port}`;
        const {data} = await api.get(browserURL + '/json/version');
        
        // 如果能成功获取到浏览器信息，说明窗口仍然可用
        if (data) {
          logger.info(`Window ${id} is already running on port ${windowData.port}`);
          await WindowDB.ensureFingerprintSnapshot(id, windowData);
          // 获取浏览器实例，把窗口放到最前面
          const browser = await puppeteer.connect({
            browserWSEndpoint: data.webSocketDebuggerUrl,
            defaultViewport: null,
          });
          const pages = await browser.pages();
          if (pages.length > 0) {
            await pages[0].bringToFront();
            // 取消连接
            await browser.disconnect();
          }
          return {
            ...data,
          };
        }
      } catch (error) {
        // 如果获取失败，说明窗口虽然标记为打开但实际已关闭
        logger.warn(`Window ${id} marked as running but not accessible, will reopen`);
        await WindowDB.update(id, {
          ...windowData,
          status: 1,
          port: null,
          pid: null,
        });
      }
    }

    const extensionData = await ExtensionDB.getExtensionsByWindowId(id);
    const proxyData = await ProxyDB.getByIdForConnection(windowData.proxy_id);
    const proxyType = proxyData?.proxy_type?.toLowerCase();
    const settings = getSettings();

    const cachePath = settings.profileCachePath;
    try {
      ensureProfileCachePath(cachePath);
    } catch (error) {
      const message = (error as Error).message;
      logger.error(`Profile cache path is unavailable: ${message}`);
      bridgeMessageToUI({
        type: 'error',
        text: message,
      });
      return null;
    }

    let launchTarget;
    try {
      launchTarget = getBrowserLaunchTarget(settings);
    } catch (error) {
      const message = (error as Error).message;
      logger.error(`Browser core is unavailable: ${message}`);
      bridgeMessageToUI({
        type: 'error',
        text: message,
      });
      return null;
    }

    const win = BrowserWindow.getAllWindows()[0];
    let windowDataDir = join(
      cachePath,
      ...launchTarget.profileDirectorySegments,
      windowData.profile_id,
    );
    const isMac = process.platform === 'darwin';
    if (launchTarget.managed) {
      try {
        windowDataDir = ensureManagedProfileDirectory(windowData.profile_id);
      } catch (error) {
        logger.error(`Failed to prepare managed profile directory: ${error}`);
        return null;
      }
    }

    const driverPath = launchTarget.driverPath;
    const fingerprintSnapshot = await WindowDB.ensureFingerprintSnapshot(id, windowData);
    windowData.ua = fingerprintSnapshot.ua;
    windowData.fingerprint = serializeFingerprintSnapshot(fingerprintSnapshot);

    if (
      launchTarget.managed &&
      fingerprintSnapshot.networkConsistency.proxyRequired &&
      (!proxyData?.proxy || !proxyType)
    ) {
      const message = 'Managed native fingerprint profiles require a proxy before launch.';
      logger.error(message);
      bridgeMessageToUI({
        type: 'error',
        text: message,
      });
      return null;
    }

    let ipInfo = {timeZone: '', ip: '', ll: [], country: ''};
    if (windowData.proxy_id && proxyData?.proxy) {
      ipInfo = await getProxyInfo(proxyData);
      if (!ipInfo?.ip) {
        const message = 'Proxy check failed. Managed native fingerprint will not launch direct.';
        logger.error(message);
        bridgeMessageToUI({
          type: launchTarget.managed ? 'error' : 'warning',
          text: message,
        });
        if (launchTarget.managed && fingerprintSnapshot.networkConsistency.proxyRequired) {
          return null;
        }
      }
      if (
        launchTarget.managed &&
        ipInfo?.timeZone &&
        ipInfo.timeZone !== fingerprintSnapshot.timezone
      ) {
        const message = `Proxy timezone ${ipInfo.timeZone} differs from fingerprint timezone ${fingerprintSnapshot.timezone}.`;
        logger.warn(message);
        bridgeMessageToUI({
          type: 'warning',
          text: message,
        });
      }
    }

    if (driverPath) {
      const chromePort = await getAvailablePort();
      let finalProxy;
      let proxyServer: Server<typeof IncomingMessage, typeof ServerResponse> | ProxyChain.Server;
      if (proxyData && proxyType === 'socks5' && proxyData.proxy) {
        const proxyInstance = await createSocksProxy(proxyData);
        finalProxy = proxyInstance.proxyUrl;
        proxyServer = proxyInstance.proxyServer;
      } else if (proxyData && proxyType === 'http' && proxyData.proxy) {
        const proxyInstance = await createHttpProxy(proxyData);
        finalProxy = proxyInstance.proxyUrl;
        proxyServer = proxyInstance.proxyServer;
      }

      const isMac = process.platform === 'darwin';
      const appStartUrl = getClientPort()
        ? `http://localhost:${getClientPort()}/#/start?windowId=${id}&serverPort=${getPort()}`
        : undefined;
      const launchParamter = buildBrowserLaunchParameters({
        managed: launchTarget.managed,
        chromePort,
        windowDataDir,
        finalProxy,
        headless,
        isMac,
        appStartUrl,
        userExtensionPaths: extensionData.map(extension => extension.path),
        snapshot: fingerprintSnapshot,
      });

      // 添加调试参数（如果需要）
      if (process.env.NODE_ENV === 'development') {
        // launchParamter.push(
        //   '--enable-logging',
        //   '--v=1',
        //   '--enable-blink-features=IdleDetection',
        // );
      }
      // const iconPath = await generateChromeIcon(windowDataDir, id);


      let chromeInstance;
      try {
        // if (isMac) {
        //   chromeInstance = spawn(driverPath, launchParamter);
        // } else {
        //   try {
        //     const shortcutPath = path.join(windowDataDir, `chrome-${windowData.id}.lnk`);
        //     await createShortcutWithIcon(driverPath, launchParamter, iconPath, shortcutPath);
        //     console.log('shortcutPath', shortcutPath);
        //     console.log('driverPath', driverPath);
        //     chromeInstance = spawn('cmd.exe', ['/c', 'start', '', shortcutPath]);
        //     console.log('chromeInstance', chromeInstance);
        //   } catch (error) {
        //     logger.error(error);
        //     chromeInstance = spawn(driverPath, launchParamter);
        //   }
        // }
        chromeInstance = spawn(driverPath, launchParamter, {
          env: launchTarget.managed
            ? {
                ...process.env,
                TZ: fingerprintSnapshot.timezone,
                LANG: `${fingerprintSnapshot.locale}.UTF-8`,
              }
            : process.env,
        });
      } catch (error) {
        logger.error(error);
      }
      if (!chromeInstance) {
        return;
      }
      await sleep(1);
      win.webContents.send('window-opened', id);
      chromeInstance.stdout.on('data', _chunk => {
        // const str = _chunk.toString();
        // console.error('stderr: ', str);
      });
      // 这个地方需要监听 stderr，否则在某些网站会出现卡死的情况
      chromeInstance.stderr.on('data', _chunk => {
        // const str = _chunk.toString();
        // console.error('stderr: ', str);
      });

      chromeInstance.on('close', async () => {
        logger.info(`Chrome process exited at port ${chromePort}, closed time: ${new Date()}`);
        if (proxyType === 'socks5') {
          (proxyServer as Server<typeof IncomingMessage, typeof ServerResponse>)?.close(() => {
            logger.info('Socks5 Proxy server was closed.');
          });
        } else if (proxyType === 'http') {
          (proxyServer as ProxyChain.Server).close(true, () => {
            logger.info('Http Proxy server was closed.');
          });
        }
        await closeFingerprintWindow(id, false);
      });

      await waitForChromeReady(chromePort, id, 30);

      try {
        const browserURL = `http://${HOST}:${chromePort}`;
        const {data} = await api.get(browserURL + '/json/version');
        await WindowDB.update(windowData.id, {
          ...windowData,
          status: 2,
          pid: chromeInstance.pid,
          port: chromePort,
          opened_at: db.fn.now() as unknown as string,
        });
        return {
          ...data,
        };
      } catch (error) {
        logger.error('open window failed', error);

        // 检查进程是否存在并终止
        if (chromeInstance.pid) {
          try {
            if (process.platform === 'win32') {
              try {
                // 使用 chcp 65001 设置控制台代码页为 UTF-8
                execSync('chcp 65001', {stdio: 'ignore'});

                // 检查进程是否存在
                execSync(`tasklist /FI "PID eq ${chromeInstance.pid}" /NH /FO CSV`, {
                  encoding: 'utf8',
                  stdio: ['ignore', 'pipe', 'ignore'],
                });

                // 进程存在，终止它
                execSync(`taskkill /PID ${chromeInstance.pid} /F /T`, {
                  encoding: 'utf8',
                  stdio: ['ignore', 'pipe', 'ignore'],
                });

                logger.info(`Successfully terminated process ${chromeInstance.pid}`);
              } catch (err) {
                if ((err as {status: number}).status === 128) {
                  logger.info(`Process ${chromeInstance.pid} does not exist`);
                } else {
                  throw err;
                }
              }
            } else {
              // Unix系统的处理保持不变
              try {
                process.kill(chromeInstance.pid, 0);
                execSync(`kill -9 ${chromeInstance.pid}`);
              } catch (err) {
                logger.info(`Process ${chromeInstance.pid} does not exist`);
              }
            }
          } catch (killError) {
            logger.error(`Failed to kill process ${chromeInstance.pid}:`, killError);
          }
        }
        await closeFingerprintWindow(id, true);
        return null;
      }
    } else {
      bridgeMessageToUI({
        type: 'error',
        text: 'Driver path is empty',
      });
      logger.error('Driver path is empty');
      return null;
    }
  } finally {
    release();
  }
}

async function createHttpProxy(proxyData: DB.Proxy) {
  const listenPort = await portscanner.findAPortNotInUse(30000, 40000);
  const [httpHost, httpPort, username, password] = proxyData.proxy!.split(':');

  const oldProxyUrl = `http://${username}:${password}@${httpHost}:${httpPort}`;
  const newProxyUrl = await ProxyChain.anonymizeProxy({
    url: oldProxyUrl,
    port: listenPort,
  });
  const proxyServer = new ProxyChain.Server({
    port: listenPort,
  });

  return {
    proxyServer,
    proxyUrl: newProxyUrl,
  };
}

async function createSocksProxy(proxyData: DB.Proxy) {
  const listenHost = HOST;
  const listenPort = await portscanner.findAPortNotInUse(30000, 40000);
  const [socksHost, socksPort, socksUsername, socksPassword] = proxyData.proxy!.split(':');

  const proxyServer = SocksServer({
    listenHost,
    listenPort,
    socksHost,
    socksPort: +socksPort,
    socksUsername,
    socksPassword,
  });

  // 添加更多错误处理
  proxyServer.on('error', err => {
    logger.error('Socks server error:', err);
  });

  proxyServer.on('connect:error', err => {
    logger.error('Socks connect error:', err);
  });

  proxyServer.on('request:error', err => {
    logger.error('Socks request error:', err);
  });

  // 添加连接关闭处理
  proxyServer.on('close', () => {
    logger.info('Socks server closed');
  });

  return {
    proxyServer,
    proxyUrl: `http://${listenHost}:${listenPort}`,
  };
}

export async function resetWindowStatus(id: number) {
  const window = await WindowDB.getById(id);
  await WindowDB.update(id, {...window, status: 1, port: null, pid: null});
}

export async function closeFingerprintWindow(id: number, force = false) {
  stopFingerprintCdpSession(id);
  const window = await WindowDB.getById(id);
  const port = window.port;
  if (force && port) {
    try {
      const browserURL = `http://${HOST}:${port}`;
      const {data} = await api.get(browserURL + '/json/version');
      const browser = await puppeteer.connect({
        browserWSEndpoint: data.webSocketDebuggerUrl,
        defaultViewport: null,
      });
      logger.info('close browser', browserURL);
      await browser?.close();
    } catch (error) {
      logger.error(error);
    }
  }
  await WindowDB.update(id, {...window, status: 1, port: null, pid: null});
  const win = getMainWindow();
  if (win) {
    win.webContents.send('window-closed', id);
  }
}

export default {
  openFingerprintWindow,

  closeFingerprintWindow,
};
