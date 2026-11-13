// Minimal SMTP sink for local testing: stores each email as a JSON line in mail.jsonl.
import { appendFileSync } from "node:fs";
import { SMTPServer } from "smtp-server";
import { simpleParser } from "mailparser";

const out = new URL("./mail.jsonl", import.meta.url).pathname;
const server = new SMTPServer({
  authOptional: true,
  disabledCommands: ["STARTTLS"],
  onData(stream, _session, cb) {
    simpleParser(stream).then((m) => {
      appendFileSync(out, JSON.stringify({ to: m.to?.text, subject: m.subject, html: m.html, text: m.text }) + "\n");
      cb();
    }, cb);
  },
});
server.listen(2525, "127.0.0.1", () => console.log("smtp sink on 127.0.0.1:2525"));
