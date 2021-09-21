#!/usr/bin/env python3

#
# Copyright (c) 2021 Antmicro <www.anmticro.com>
#

from http import server
import base64
import urllib.request
import time
import socketserver

class CustomHTTPRequestHandler(server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path[0:7] == "/proxy/":
            real_path = base64.b64decode(self.path[7:].encode('ascii')).decode('ascii')
            print("TODO: should get",real_path)
            self.send_response(200)
            self.end_headers()
            self.copyfile(urllib.request.urlopen(real_path), self.wfile)
        else:
            super().do_GET()

    def end_headers(self):
        self.send_custom_headers()
        super().end_headers()

    def send_custom_headers(self):
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")


if __name__ == '__main__':
    port = 8000
    httpd = None;
    while (httpd == None):
        try:
            httpd = socketserver.ForkingTCPServer(('', port), CustomHTTPRequestHandler)
        except:
            httpd = None
            time.sleep(2)
    print("Serving content on :%d" % port)

    httpd.serve_forever();
