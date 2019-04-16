// @flow
import { initialize, LDClient, LDFlagSet, LDFlagValue, LDOptions, LDUser } from 'ldclient-js';
import React, { useState } from 'react';
import { unset } from 'lodash';
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
    reset: (flag: string) => {
      if (devTooling) {
        callbacks.forEach(c => c({ [flag]: allFlagsOriginal()[flag] }));
        unset(localStore, flag);
        cookies.set('force_ffs', JSON.stringify(localStore));
      }
    },
    resetAll: () => {
      if (devTooling) {
        callbacks.forEach(c => c(allFlagsOriginal()));
        Object.keys(localStore).forEach(k => unset(localStore, k));
        cookies.set('force_ffs', JSON.stringify(localStore));
      }
    },
    allFlags: () => ({
      ...allFlagsOriginal(),
      ...localStore,
    }),
    isForced: flag => localStore[flag] !== undefined,
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
  };

  const FlagEntry = ({ flagKey, flagValue, forcedIn }) => {
    const [val, setVal] = useState(flagValue);
    const [forced, setForced] = useState(forcedIn);
    const onToggle = () => {
      setVal(!val);
      change(flagKey, !val);
      setForced(true);
    };

    const onReset = () => {
      setVal(flagValue);
      change(flagKey, flagValue);
      setForced(false);
      client.reset(flagKey);
    };

    return (
      <div style={{ margin: '4px 0' }}>
        <span style={{ width: '60px', display: 'inline-block' }}>
          {
            flagValue === true ?
              <span>
                <button onClick={onToggle}>Turn off</button>
              </span>
              :
              <span>
                <button onClick={onToggle}>Turn on</button>
              </span>
          }
        </span>
        <span style={{
          width: '30px',
          display: 'inline-block',
          color: val === true ? 'darkgreen' : 'darkred',
          fontWeight: val === true ? 'bold' : 'normal',
        }}
        >
          {
            val === true ? 'On' : 'Off'
          }
        </span>
        <span>{flagKey}</span>
        {forced &&
        <div style={{
          float: 'right',
        }}
        >
          <span style={{
            display: 'inline-block',
            margin: '0 2px',
            color: 'darkmagenta',
            fontWeight: '500',
            fontSize: 'small',
          }}
          >
          Forced locally
          </span>
          <button onClick={onReset}>reset</button>
        </div>
        }

      </div>
    );
  };

  const resetAll = () => {
    client.resetAll();
    removeWindow();
    renderWindow();
  };

  const SearchBox = ({ filter, onFilter }) => (
    <div style={{ margin: '4px 0' }}>
      <input
        style={{
          padding: '2px 4px',
        }}
        type="text"
        placeholder="Filter"
        value={filter}
        onChange={e => onFilter(e.target.value)}
        autoFocus
      />
      <button onClick={resetAll} style={{ float: 'right' }}>Reset all</button>
    </div>
  );

  const Modal = () => {
    const filter = localStorage.getItem('__ldwrapper.filter');
    const [filterState, setFilterState] = useState(null);
    const setFilter = (f) => {
      localStorage.setItem('__ldwrapper.filter', f);
      setFilterState(f);
    };
    const style = {
      backgroundColor: '#fefefe',
      border: '1px solid #888',
      fontSize: '16px',
      position: 'absolute',
      padding: '16px',
      top: '10vh',
      left: '33vw',
      width: '34vw',
      height: '80vh',
      overflowY: 'scroll',
    };
    const flags = client.allFlags();
    const flagKeys = (filter && filter.length > 0 ?
      Object.keys(flags)
        .filter(f => f.indexOf(filter) !== -1) :
      Object.keys(flags))
      .filter(f => typeof flags[f] === 'boolean');

    return (
      <div style={style} role="dialog" onClick={e => e.stopPropagation()}>
        <h3>Feature flags</h3>
        <SearchBox onFilter={setFilter} filter={filter} />
        <div>
          {flagKeys.map(key =>
            (<FlagEntry
              key={key}
              flagKey={key}
              flagValue={flags[key]}
              forcedIn={client.isForced(key)}
            />))}
        </div>
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
    } else {
      lastF = 0;
    }
  });
}

const buildClient = (apiKey: string, user: LDUser, options?: LDOptions): LDClientExtended =>
  extendClient(init(apiKey, user, options));

export default buildClient;
