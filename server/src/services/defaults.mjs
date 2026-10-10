/**
 * Empty manifest structure used before the first configuration is published.
 */

export function getEmptyManifest() {
  return {
    serverTime: '',
    updatedAt: '',
    maintenance: {
      enabled: false,
      mode: 'soft',
      title: '',
      message: ''
    },
    news: [],
    announcements: [],
    featuredServers: [],
    client: {
      latestVersion: '',
      minimumVersion: '',
      updateUrl: '',
      notesUrl: ''
    },
    flags: {
      cosmeticsEnabled: false,
      multiplayerRichPresence: false,
      experimentalUi: false,
      cloudSyncEnabled: false
    },
    links: {
      website: 'https://dewclient.fun',
      support: 'https://dewclient.fun/#support',
      download: 'https://dewclient.fun/#download',
      discord: 'https://discord.gg/uXs2YD4D6H'
    }
  };
}
