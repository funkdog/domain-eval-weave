// Worker-owned completion, deliberately separate from the Agent's task outcome.
export async function finishCodingWorker({ flush, dispose, record, exitCode, timeoutMs = 5000 }) {
  let phase = "flush";
  let closing = false;
  const finish = async (status, code) => {
    if (closing) return;
    closing = true;
    clearTimeout(timer);
    try {
      await record({ status, exitCode: code });
    } catch {
      code = 1; // Receipt failure must not be rendered as successful shutdown.
    }
    // exitCode alone cannot terminate sockets/timers retained by an SDK after disposal.
    process.exit(code);
  };
  const timer = setTimeout(() => void finish(`${phase}_timed_out`, 2), timeoutMs);
  try {
    await flush();
    phase = "dispose";
    await dispose();
    await finish("disposed", exitCode);
  } catch {
    await finish(`${phase}_failed`, 1);
  }
}
