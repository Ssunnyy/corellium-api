const {fetchApi} = require('./util/fetch');
const EventEmitter = require('events');
const c3po = require('./c3po');
const websocket = require('websocket-stream');
const util = require('util');
const Snapshot = require('./snapshot');
const Agent = require('./agent');
const sleep = util.promisify(setTimeout);

class Instance extends EventEmitter {
    constructor(project, info) {
        super();

        this.project = project;
        this.info = info;
        this.id = info.id;
        this.updating = false;

        this.hash = null;
        this.hypervisorStream = null;
        this.agentStream = null;
        this.lastPanicLength = null;
        this.volumeId = null;

        this.on('newListener', () => this.manageUpdates());
    }

    get name() {
        return this.info.name;
    }

    get state() {
        return this.info.state;
    }

    get flavor() {
        return this.info.flavor;
    }

    async rename(name) {
        await this._fetch('', {
            method: 'PATCH',
            json: {name},
        });
    }

    async snapshots() {
        const snapshots = await this._fetch('/snapshots');
        return snapshots.map(snap => new Snapshot(this, snap));
    }

    async takeSnapshot(name) {
        const snapshot = await this._fetch('/snapshots', {
            method: 'POST',
            json: {name},
        });
        return new Snapshot(this, snapshot);
    }

    async consoleLog() {
        let hypervisor = await this.hypervisor();
        let results = await hypervisor.command(await hypervisor.signedCommand(this.id, Buffer.from(this.info.key, 'hex'), {
            'type': 'console',
            'op': 'get'
        }));
        return results['log'];
    }

    async panics() {
        let hypervisor = await this.hypervisor();
        let results = await hypervisor.command(await hypervisor.signedCommand(this.id, Buffer.from(this.info.key, 'hex'), {
            'type': 'panic',
            'op': 'get'
        }));
        return results['panics'];
    }

    async clearPanics() {
        let hypervisor = await this.hypervisor();
        return hypervisor.command(await hypervisor.signedCommand(this.id, Buffer.from(this.info.key, 'hex'), {
            'type': 'panic',
            'op': 'clear'
        }));
    }

    async hypervisor() {
        await this._waitFor(() => this.info.services.vpn && this.info.services.vpn.ip);

        let endpoint = this.project.api + '/c3po/' + this.info.c3po;

        if (this.hypervisorStream && this.hypervisorStream.active) {
            if (endpoint === this.hypervisorStream.endpoint)
                return this.hypervisorStream;

            this.hypervisorStream.disconnect();
            this.hypervisorStream = null;
        }

        this.hypervisorStream = new c3po.HypervisorStream(endpoint);
        return this.hypervisorStream;
    }

    async agent() {
        await this._waitFor(() => !!this.info.agent);
        let endpoint = this.project.api + '/agent/' + this.info.agent.info;

        if (this.agentStream && this.agentStream.active) {
            if (endpoint === this.agentStream.endpoint)
                return this.agentStream;

            this.agentStream.disconnect();
            this.agentStream = null;
        }

        this.agentStream = new Agent(endpoint);
        return this.agentStream;
    }

    async console() {
        const {url} = await this._fetch('/console');
        return websocket(url, ['binary']);
    }

    async start() {
        await this._fetch('/start', {method: 'POST'});
    }

    async stop() {
        await this._fetch('/stop', {method: 'POST'});
    }

    async reboot() {
        await this._fetch('/reboot', {method: 'POST'});
    }

    async destroy() {
        await this._fetch('', {method: 'DELETE'});
    }

    async takeScreenshot() {
        const res = await this._fetch('/screenshot.png', {response: 'raw'});
        return await res.buffer();
    }

    async update() {
        const info = await this._fetch('');
        // one way of checking object equality
        if (JSON.stringify(info) != JSON.stringify(this.info)) {
            this.info = info;
            this.emit('change');
            if (info.panicked)
                this.emit('panic');
        }
    }

    manageUpdates() {
        if (this.updating)
            return;
        process.nextTick(async () => {
            this.updating = true;
            do {
                await this.update();
                await sleep(1000);
            } while (this.listenerCount('change') != 0);
            this.updating = false;
        });
    }

    async _waitFor(callback) {
        return new Promise(resolve => {
            const change = () => {
                let done;
                try {
                    done = callback();
                } catch (e) {
                    done = false;
                }
                if (done) {
                    this.removeListener('change', change);
                    resolve();
                }
            };

            this.on('change', change);
            change();
        });
    }

    async finishRestore() {
        await this._waitFor(() => this.state !== 'creating');
    }

    async waitForState(state) {
        await this._waitFor(() => this.state === state);
    }

    async _fetch(endpoint = '', options = {}) {
        return await fetchApi(this.project, `/instances/${this.id}${endpoint}`, options);
    }
}

module.exports = Instance;
