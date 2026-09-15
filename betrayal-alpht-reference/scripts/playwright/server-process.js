const { startServer } = require('../../server');

let started;

async function stop() {
  if (started) {
    await started.stop();
  }
  process.exit(0);
}

process.once('SIGINT', () => { void stop(); });
process.once('SIGTERM', () => { void stop(); });

startServer({ portCandidates: [0] })
  .then((runtime) => {
    started = runtime;
    console.log(`PORT=${runtime.port}`);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
