FROM node:20-bookworm-slim

ENV CAPTURES_PATH=/captures/
ENV SHARKD_SOCKET=/home/node/sharkd.sock

RUN apt update \
    && apt install --no-install-recommends -y procps curl wireshark-common unzip git ca-certificates libglib2.0-0 speex libspeex1 libspeexdsp1 libc-ares2 libxml2 \
    && mkdir -p /captures \
    && chown -R node: /captures \
    && rm -rf /var/lib/apt/lists/*

COPY --chown=node . /usr/src/node-webshark

RUN mkdir /usr/src/web \
 && cd /usr/src/web \
 && curl -LO https://github.com/QXIP/webshark-ui/releases/download/1.0.0/latest.zip \
 && unzip latest.zip \
 && rm -rf latest.zip \
 && sed -i 's|href="/"|href="/webshark/"|g' index.html

# Wire the live-update shim (web/live-update.js, kept from the repo copy above)
# into the freshly downloaded UI bundle: load the shim from index.html and
# inject the two instance-capture hooks it needs into the minified bundle.
# See web/live-update.js for details. If the patterns ever stop matching a new
# UI build, the app still works normally, just without live updates.
RUN cd /usr/src/node-webshark/web \
 && sed -i -E 's/getBufferGate\(([A-Za-z0-9_$]+)\)\{/getBufferGate(\1){window.__wsLive\&\&window.__wsLive.svc(this);/' main.*.js \
 && sed -i -E 's/initData\(\)\{var ([A-Za-z0-9_$]+)=this;/initData(){var \1=this;window.__wsLive\&\&window.__wsLive.comp(this);/' main.*.js \
 && sed -i 's|<script src="runtime|<script src="live-update.js?v=10"></script><script src="runtime|' index.html

WORKDIR /usr/src/node-webshark/api
RUN npm install

EXPOSE 8085
ENTRYPOINT [ "/usr/src/node-webshark/entrypoint.sh" ]
