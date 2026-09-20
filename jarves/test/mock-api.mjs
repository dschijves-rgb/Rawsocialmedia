// Stands in for the worker. Records what the browser sends and drives a full
// tool_use -> tool_result -> text round trip.
import { createServer } from 'http';

export const seen = [];

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, x-jarves-key',
};

export function start(port = 8732) {
  const server = createServer((req, res) => {
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw);
      seen.push({ body, key: req.headers['x-jarves-key'] });

      // Turn 1 -> ask for a tool. Turn 2 -> answer.
      const usedTool = body.messages.some(
        (m) => Array.isArray(m.content) && m.content.some((b) => b.type === 'tool_result')
      );

      const payload = usedTool
        ? { id: 'msg_2', type: 'message', role: 'assistant', model: 'claude-opus-5',
            stop_reason: 'end_turn',
            content: [{ type: 'text', text: 'Locked in — Thursdays are your shoot days.' }] }
        : { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5',
            stop_reason: 'tool_use',
            content: [
              { type: 'text', text: 'Noting that.' },
              { type: 'tool_use', id: 'toolu_1', name: 'remember',
                input: { text: 'I shoot content on Thursdays', tags: ['schedule'] } },
            ] };

      res.writeHead(200, { 'content-type': 'application/json', ...CORS });
      res.end(JSON.stringify(payload));
    });
  });
  return new Promise((r) => server.listen(port, () => r(server)));
}
