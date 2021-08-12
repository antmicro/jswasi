function get_parent_port() {
    let is_node = (typeof self === 'undefined');
    if (is_node) {
        const { parentPort } = require('worker_threads');
        return parentPort;
    }
    return null;
}

exports.get_parent_port = get_parent_port;
exports.fs = require('fs');
