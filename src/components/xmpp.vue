<template>
  <div class="xmpp-chat-client-container">
    <h1>XMPP client with Vue and Strophe.js</h1>

    <fieldset>
      <p>
        JID: <input type="text" v-model="jid" />
      </p>
      <p>
        Password: <input type="password" v-model="password" />
      </p>
      <p>
        <button @click="connect">Connect</button>&nbsp;
        <button @click="disconnect">Disconnect</button>
      </p>
    </fieldset>

    <div class="chat-session-container" v-if="sessionReady">
      <div class="roster-container">
        <h3>Roster</h3>
        <p style="text-align: center;">
          <input type="text" placeholder="My status…" v-model="statusMsg" />
          <button style="margin-left: 10px;" @click="setStatus">Set</button>
        </p>

        <div class="roster-item" v-for="item in roster" :key="item.jid">
          <div class="roster-item-jid">{{ item.jid }} (<strong>{{ item.show }}</strong>)</div>
          <div class="roster-item-status">{{ item.status }}</div>
        </div>
      </div>

      <div class="chat-container">
        <p>
          Chatting with: <input type="text" placeholder="bar@localhost" v-model="toJid"/>
        </p>

        <div class="message-timeline">
          <p v-for="(m, idx) in messages" :key="idx">
            <span>{{ m.from }}:&nbsp;</span>
            <span>{{ m.body }}</span>
            <span class="message-timestamp">({{ m.stamp }})</span>
          </p>

          <p v-if="sessionDisconnected">
            <strong>The session has ended.</strong>
          </p>
        </div>

        <div class="chatbox-container">
          <input type="text" placeholder="Send a message…" v-model="chatbox" @keyup.enter="sendMsg" />
          <button @click="sendMsg">Send</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { Strophe, $iq, $pres, $msg } from 'strophe.js';

export function uuid() {
  return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
}

export default {
  name: 'xmpp',
  data: () => ({
    conn: null,
    chatbox: null,
    statusMsg: null,
    toJid: null,
    jid: 'foo@localhost',
    password: 'password',
    roster: [],
    messages: [],
    sessionReady: false,
    sessionDisconnected: false,
  }),
  methods: {
    connect() {
      //   WS: "wss://localhost:5443/ws"
      // BOSH: "https://localhost:5280/bosh"
      this.conn = new Strophe.Connection("wss://localhost:5443/ws");

      console.log('connecting...');
      this.conn.connect(this.jid, this.password, (status) => {
        switch (status) {
          case Strophe.Status.CONNECTED:
            console.log('connected!');
            this.sessionDisconnected = false;
            this.initHandlers();
            break;
          case Strophe.Status.ATTACHED:
            console.log('attached');
            break;
          case Strophe.Status.CONNFAIL:
            console.log('ERROR: Connection Failed');
            break;
          case Strophe.Status.AUTHFAIL:
            console.log('ERROR: Auth Failed');
            break;
          case Strophe.Status.CONNTIMEOUT:
            console.log('ERROR: Connection Timeout');
            break;
          case Strophe.Status.DISCONNECTING:
            console.log('ERROR: Disconnecting');
            break;
          case Strophe.Status.DISCONNECTED:
            console.log('ERROR: Disconnected');
            this.sessionDisconnected = true;
            break;
        };
      });
    },
    disconnect() {
      this.conn.disconnect();
    },
    setStatus() {
      this.conn.sendPresence(
        $pres().c('status').t(this.statusMsg).tree(),
        (iq) => {
          console.log('status updated:', iq);
        }, // Success
        (e) => {
          console.log('error setting status:', e);
        }, // Error
        null, // Timeout
      );
    },
    sendMsg() {
      if (this.sessionDisconnected) {
        return;
      }

      const timestamp = new Date().toISOString();
      const msg = {
        from: this.jid,
        body: this.chatbox,
        stamp: timestamp,
      };
      this.messages.push(msg);

      this.conn.sendIQ(
        $msg({
          to: this.toJid,
          type: 'chat',
        }).c('stamp').t(timestamp)
          .up()
          .c('body').t(this.chatbox),
        (iq) => {
          console.log('message sent:', iq);
        }, // Success
        (e) => {
          console.log('error sending message:', e);
        }, // Error
        null, // Timeout
      );
      this.chatbox = null;
    },
    initHandlers() {
      this.sessionReady = true;
      this.conn.send($pres()); // Set status as available

      // Get roster
      this.conn.sendIQ(
        $iq({
          type: 'get',
          id: uuid(),
        }).c('query', { xmlns: Strophe.NS.ROSTER }),
        (iq) => {
          const contacts = iq.getElementsByTagName('item');

          contacts.forEach((item) => {
            const jid = item.getAttribute('jid');
            const subscription = item.getAttribute('subscription');

            // Update roster
            const idx = this.roster.findIndex((x) => x.jid === jid);
            if (idx === -1) {
              if (subscription === "remove") {
                this.roster.splice(idx, 1);
              } else {
                this.roster.push({ jid: jid, show: 'offline' });
              }
            }
          });
        },
      );

      // Presence handler
      this.conn.addHandler(
        (pres) => {
          const show = pres.getElementsByTagName('show')[0];
          const status = pres.getElementsByTagName('status')[0];
          const to = Strophe.getBareJidFromJid(pres.getAttribute('to'));
          const from = Strophe.getBareJidFromJid(pres.getAttribute('from'));

          // Skip presence from yourself
          if (to === from) {
            return true;
          }

          // Update roster
          const contact = {
            jid: from,
            show: show?.textContent || 'online',
            status: status?.textContent || '',
          };

          const idx = this.roster.findIndex((x) => x.jid === contact.jid);
          if (idx !== -1) {
            this.roster.splice(idx, 1, contact); // splice is needed to update UI
          } else {
            this.roster.push(contact);
          }

          return true; // Do not deregister handler
        },
        null, // namespace
        'presence', // stanza name
        null, // stanza id
        null, // stanza type
        null, // stanza from
        null, // handler options
      );

      // Message handler
      this.conn.addHandler(
        (msg) => {
          const from = Strophe.getBareJidFromJid(msg.getAttribute('from'));
          const body = msg.getElementsByTagName('body')[0];

          if (from && body) {
            console.log('incoming message:', msg);

            const delay = msg.getElementsByTagName('delay')[0];
            const stamp = delay?.getAttribute('stamp') || new Date().toISOString();
            this.messages.push({ from, body: body.textContent, stamp });
          }

          return true; // Do not deregister handler
        },
        null, // namespace
        'message', // stanza name
        null, // stanza id
        null, // stanza type
        null, // stanza from
        null, // handler options
      );
    },
  },
};
</script>

<style>
.chat-container {
  width: 500px;
  margin: 20px auto;
  padding: 20px;
  border: 2px solid #000;

  display: flex;
  flex-direction: column;
  flex-direction: space-between;
}

.chat-client-actions {
  margin: 20px;
}

.message-timeline {
  height: 300px;
  overflow-y: auto;
}

.chatbox-container {
  display: flex;
  justify-content: center;
}

.chatbox-container input {
  width: 100%;
  padding: 10px;
  margin-right: 20px;
}

.message-timeline .message-timestamp {
  float: right;
}

.chat-session-container {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.roster-container {
  float: left;

  margin: 20px;
  width: 300px;
  height: 300px;
  overflow-y: auto;
  border: 2px solid #000;
}

.roster-container h3 {
  text-align: center;
}

.roster-container .roster-item {
  margin: 10px;
  padding: 10px;
  background: #eee;
}

</style>
