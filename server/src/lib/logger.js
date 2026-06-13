function emit(level, msg, extra = {}) {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ t: new Date().toISOString(), level, msg, ...extra }));
}

export const logger = {
  info: (msg, extra) => emit('info', msg, extra),
  warn: (msg, extra) => emit('warn', msg, extra),
  error: (msg, extra) => emit('error', msg, extra),
};
