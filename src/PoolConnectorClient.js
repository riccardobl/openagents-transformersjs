import { PoolConnectorClient as _PoolConnectorClient } from "openagents-grpc-proto";
import * as GRPC from "@grpc/grpc-js";
import { GrpcTransport } from "@protobuf-ts/grpc-transport";

export default class PoolConnectorClient extends _PoolConnectorClient {
    constructor(
        ip, 
        port,
        rootCerts,
        privateKey,
        publicKey
    ) {
        super(
            new GrpcTransport({
                host: `${ip}:${port}`,
                channelCredentials: 
                (!rootCerts || !privateKey || !publicKey)?
                GRPC.ChannelCredentials.createInsecure():
                GRPC.ChannelCredentials.createSsl(
                    rootCerts,
                    privateKey,
                    publicKey,
                )        
            })
        );
    }

    async r(c) {
        const cc = await c;
        const rpcStatus = await cc.status;
        if (!( rpcStatus.code.toString()=="0"|| rpcStatus.code.toString()=="OK")) {
            throw new Error(`rpc failed with status ${rpcStatus.code}: ${rpcStatus.detail}`);
        }
        return cc.response;
    }
}
