FROM node:20-bookworm as intermediate

RUN apt-get update && apt-get install -y \
	git sed wget unzip make python3 cmake flex bison libglib2.0-dev libgcrypt20-dev libspeex-dev libspeexdsp-dev libc-ares-dev \
	&& rm -rf /var/lib/apt/lists/*

RUN mkdir -p /out /usr/src /var/run
WORKDIR /usr/src

RUN git clone --depth=1 https://github.com/qxip/node-webshark.git /usr/src/node-webshark
RUN git clone --depth=1 https://gitlab.com/wireshark/wireshark.git /usr/src/wireshark

WORKDIR /usr/src/wireshark
RUN ../node-webshark/sharkd/build.sh

WORKDIR /usr/src
RUN mkdir web \
 && cd web \
 && wget github.com/qxip/webshark-ui/releases/latest/download/latest.zip \
 && unzip latest.zip \
 && rm -rf latest.zip \
 && sed -i 's|href="/"|href="/webshark/"|g' index.html


FROM node:20-bookworm-slim

RUN apt update \
    && apt install -y git libglib2.0-0 speex libspeex1 libspeexdsp1 libc-ares2 libxml2 \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /captures /usr/local/bin /usr/local/share/wireshark/ \
    && chown -R node: /captures

COPY --from=intermediate /usr/src/wireshark/build/run/sharkd /usr/local/bin/sharkd
COPY --from=intermediate /usr/src/wireshark/build/run/colorfilters /usr/local/share/wireshark/colorfilters

ENV CAPTURES_PATH=/captures/
ENV SHARKD_SOCKET=/captures/sharkd.sock

COPY --chown=node . /usr/src/node-webshark
COPY --from=intermediate /usr/src/web /usr/src/node-webshark/web

# Wire the live-update shim (web/live-update.js, kept from the repo copy above)
# into the freshly downloaded UI bundle: load the shim from index.html and
# inject the two instance-capture hooks it needs into the minified bundle.
# See web/live-update.js for details. If the patterns ever stop matching a new
# UI build, the app still works normally, just without live updates.
RUN cd /usr/src/node-webshark/web \
 && sed -i -E 's/getBufferGate\(([A-Za-z0-9_$]+)\)\{/getBufferGate(\1){window.__wsLive\&\&window.__wsLive.svc(this);/' main.*.js \
 && sed -i -E 's/initData\(\)\{var ([A-Za-z0-9_$]+)=this;/initData(){var \1=this;window.__wsLive\&\&window.__wsLive.comp(this);/' main.*.js \
 && sed -i 's|<script src="runtime|<script src="live-update.js?v=10"></script><script src="runtime|' index.html

VOLUME /captures

WORKDIR /usr/src/node-webshark/api
RUN npm install

EXPOSE 8085
ENTRYPOINT [ "/usr/src/node-webshark/entrypoint.sh" ]
