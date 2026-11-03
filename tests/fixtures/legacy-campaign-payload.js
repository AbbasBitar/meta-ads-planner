export const LEGACY_FORM_ENTRIES = [
  ['client', 'Sample Client'],
  ['page', 'Sample Page'],
  ['handle', '@sampleclient'],
  ['representative', 'Rep One'],
  ['reference', 'CLIENT-001'],
  ['category', 'Photography'],
  ['product', 'Family photo sessions'],
  ['platform', 'manager'],
  ['post', 'new'],
  ['postUrl', ''],
  ['goal', 'profile'],
  ['destination', ''],
  ['channels', 'Instagram Direct'],
  ['locations', 'Beirut'],
  ['minAge', '23'],
  ['maxAge', '45'],
  ['gender', 'All'],
  ['interests', 'Family photography'],
  ['audience', 'Parents seeking family photography'],
  ['budgetType', 'lifetime'],
  ['budget', '100'],
  ['days', '7'],
  ['creative', 'Single image'],
  ['language', 'English'],
  ['notes', '']
];

// This is the exact object shape emitted by app.js getData(): non-channel
// fields retain form order and the channels array is appended last.
export const LEGACY_CAMPAIGN_PAYLOAD = Object.freeze({
  client: 'Sample Client',
  page: 'Sample Page',
  handle: '@sampleclient',
  representative: 'Rep One',
  reference: 'CLIENT-001',
  category: 'Photography',
  product: 'Family photo sessions',
  platform: 'manager',
  post: 'new',
  postUrl: '',
  goal: 'profile',
  destination: '',
  locations: 'Beirut',
  minAge: '23',
  maxAge: '45',
  gender: 'All',
  interests: 'Family photography',
  audience: 'Parents seeking family photography',
  budgetType: 'lifetime',
  budget: '100',
  days: '7',
  creative: 'Single image',
  language: 'English',
  notes: '',
  channels: ['Instagram Direct']
});

export const LEGACY_PAYLOAD_DIGEST = 'c421503a470670c482cd55e8a287d0c36e830322288b955569fed93b99cdaf76';
