FROM node:latest
RUN mkdir -p /app
WORKDIR /app
ADD . /app
RUN  \
npm i --production && \
chown 1000:1000 -Rf /app 

ENV POOL_ADDRESS="127.0.0.1"
ENV POOL_PORT=5000

ENV POOL_CA_CRT=""
ENV POOL_CLIENT_CRT=""
ENV POOL_CLIENT_KEY=""

ENV QUANTIZE="true"

USER 1000
CMD ["npm","run", "start"]
