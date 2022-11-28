#!/usr/bin/env python3

#
# Copyright (c) 2021 Antmicro <www.antmicro.com>
#

import signal
from threading import Thread
import sys
from http import server
import base64
import urllib.request
import time
import socketserver


class CustomHTTPRequestHandler(server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path[0:7] == "/proxy/":
            real_path = base64.b64decode(self.path[7:].encode("ascii")).decode("ascii")
            self.send_response(200)
            proxy_request = urllib.request.Request(real_path)
            proxy_request.add_header('User-Agent', 'Wget/1.21')
            url = urllib.request.urlopen(proxy_request)
            if url.headers['content-length'] != None:
                self.send_header('content-length', url.headers['content-length'])
            self.end_headers()
            self.copyfile(url, self.wfile)
        else:
            super().do_GET()

    def end_headers(self):
        self.send_custom_headers()
        super().end_headers()

    def send_custom_headers(self):
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")


if __name__ == "__main__":
    if len(sys.argv) > 1:
        port = int(sys.argv[1])
    else:
        port = 8000
    httpd = None
    while httpd is None:
        try:
            httpd = socketserver.ForkingTCPServer(("", port), CustomHTTPRequestHandler)
            httpd.allow_reuse_address = True
        except:
            httpd = None
            time.sleep(2)
    print("Serving content on :%d" % port)

    def kill_httpd(*args):
        thr = Thread(target=lambda h: h.shutdown(), args=(httpd,))
        thr.start()
    signal.signal(signal.SIGINT, kill_httpd)

    httpd.serve_forever()
