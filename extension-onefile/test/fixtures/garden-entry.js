import('./garden-bloom.js').then(() => {
  window.gardenStartup?.ready();
}).catch((error) => {
  window.gardenStartup?.fail(error);
});
