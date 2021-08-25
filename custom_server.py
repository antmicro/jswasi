# Custom server is needed to add headers required by usage of SharedArrayBuffer
from http import server


class CustomHTTPRequestHandler(server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_custom_headers()
        super().end_headers()

    def send_custom_headers(self):
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")


if __name__ == '__main__':
    server.test(HandlerClass=CustomHTTPRequestHandler)
