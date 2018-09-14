// @flow
import { initialize, LDClient, LDFlagSet, LDFlagValue, LDOptions, LDUser } from 'ldclient-js';
import React from 'react';
import ReactDOM from 'react-dom';
import cookies from 'js-cookie';

export interface LDClientExtended extends LDClient {
  getBoolean: (featureKey: string, defaultValue?: boolean) => Promise<boolean>,
  onReady: Promise<LDClientExtended>,
  onChange: (callback: (flags: LDFlagSet) => void) => void,
  change: (flags: LDFlagSet) => void,
}

const devTooling = process.env.NODE_ENV === 'development' ||
  process.env.REACT_APP_FFS_DEV_TOOLS_ACTIVE === 'true';

const extendClient = (client: LDClient): LDClientExtended => {
  const callbacks: ((flags: LDFlagSet) => void)[] = [];
  const localStore = devTooling ? JSON.parse(cookies.get('force_ffs') || '{}') || {} : {};
  const allFlagsOriginal = client.allFlags;

  return Object.assign(client, {
    onReady: new Promise((resolve) => {
      client.on('ready', () => resolve(client));
    }),
    getBoolean: (
      featureKey: string,
      defaultValue?: boolean,
    ): Promise<boolean> =>
      client.onReady.then(c => c.variation(featureKey, defaultValue === true)),
    onChange: (callback: (flags: LDFlagSet) => void) => {
      callbacks.push(callback);
    },
    change: (flags: LDFlagSet) => {
      if (devTooling) {
        callbacks.forEach(c => c(flags));
        Object.assign(localStore, flags);
        cookies.set('force_ffs', JSON.stringify(localStore));
      }
    },
    allFlags: () => ({
      ...allFlagsOriginal(),
      ...localStore,
    }),
  });
};


let init = (
  apiKey: string,
  user: LDUser,
  options?: LDOptions,
): LDClientExtended => initialize(apiKey, user, options);

const featureFlagStore: { [key: string]: LDFlagValue } = {};

if (devTooling) {
  const initializeRef = init;
  let client: LDClientExtended;
  init = (apiKey: string, user: LDUser, options?: LDOptions): LDClient => {
    console.log('Launchdarkly client initializing in development mode');
    client = initializeRef(apiKey, user, options);

    const originalVariation = client.variation;
    client.variation = (key: string, defaultValue?: LDFlagValue): LDFlagValue => {
      if (key in featureFlagStore) {
        console.log(`Returning value for ${key} from local store: ${featureFlagStore[key]}`);
        return featureFlagStore[key];
      }
      return originalVariation.call(this, key, defaultValue);
    };
    return client;
  };

  const root = document.createElement('div');

  if (document && document.body) {
    document.body.appendChild(root);
  }

  let open = false;

  const renderWindow = () => {
    open = true;
    ReactDOM.render(
      <Overlay />,
      root,
    );
  };

  const removeWindow = () => {
    ReactDOM.unmountComponentAtNode(root);
    open = false;
  };

  const change = (flag: string, value: any) => {
    console.log('changing', flag, 'to', value);
    client.change({ [flag]: value });
    removeWindow();
    renderWindow();
  };

  const FlagEntry = ({ flagKey, flagValue }) => (
    <div style={{ margin: '4px 0' }}>
      <span style={{ width: '60px', display: 'inline-block' }}>
        {
          flagValue === true ?
            <span>
              <button onClick={() => change(flagKey, false)}>Turn off</button>
            </span>
            :
            <span>
              <button onClick={() => change(flagKey, true)}>Turn on</button>
            </span>
        }
      </span>
      <span style={{
        width: '30px',
        display: 'inline-block',
        color: flagValue === true ? 'darkgreen' : 'darkred',
        fontWeight: flagValue === true ? 'bold' : 'normal',
      }}
      >
        {
          flagValue === true ? 'On' : 'Off'
        }
      </span>
      <span>{flagKey}</span>
    </div>
  );

  const Modal = () => {
    const style = {
      backgroundColor: '#fefefe',
      margin: '20vh auto',
      padding: '30px',
      border: '1px solid #888',
      maxWidth: '500px',
      fontSize: '16px',
    };
    const flags = client.allFlags();
    return (
      <div style={style} role="dialog" onClick={e => e.stopPropagation()}>
        {Object.keys(flags).map(key =>
          <FlagEntry key={key} flagKey={key} flagValue={flags[key]} />)}
      </div>
    );
  };

  const Overlay = () => {
    const style = {
      position: 'fixed',
      zIndex: 1,
      left: 0,
      top: 0,
      width: '100vw',
      height: '100vh',
      backgroundColor: 'rgba(0,0,0,0.4)',
    };

    return (
      <div style={style} onClick={removeWindow}>
        <Modal />
      </div>
    );
  };


  let lastF = 0;
  document.addEventListener('keyup', (event: *) => {
    const key = event.key || event.keyCode;
    if (key === 'f') {
      const now = new Date().getTime();
      if (lastF + 200 > now) {
        // callbacks.forEach(c => c({
        //   myFlag: true,
        // }));
        renderWindow();
      }
      lastF = now;
    } else if (key === 'Escape' && open) {
      removeWindow();
    }
  });
}

const buildClient = (apiKey: string, user: LDUser, options?: LDOptions): LDClientExtended =>
  extendClient(init(apiKey, user, options));

export default buildClient;
