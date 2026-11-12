// Socket Phoenix falso para os testes do canal: guarda os handlers e deixa o teste disparar o
// join, os eventos e a queda da conexão, sem servidor.
import type { ChannelLike, PushLike, SocketLike } from "../src/api/channel";

class FakePush implements PushLike {
  private hooks = new Map<string, (response?: unknown) => void>();
  receive(status: string, callback: (response?: unknown) => void) {
    this.hooks.set(status, callback);
    return this;
  }
  trigger(status: string, response?: unknown) {
    this.hooks.get(status)?.(response);
  }
}

export class FakeChannel implements ChannelLike {
  readonly joinPush = new FakePush();
  readonly handlers = new Map<string, (payload?: unknown) => void>();
  private errorHandlers: ((reason?: unknown) => void)[] = [];
  joins = 0;
  left = false;

  constructor(readonly topic: string, readonly params?: object) {}

  join() {
    this.joins += 1;
    return this.joinPush;
  }
  leave() {
    this.left = true;
    return new FakePush();
  }
  on(event: string, callback: (payload?: unknown) => void) {
    this.handlers.set(event, callback);
    return this.handlers.size;
  }
  onError(callback: (reason?: unknown) => void) {
    this.errorHandlers.push(callback);
    return this.errorHandlers.length;
  }

  /** Resposta do join (o cliente `phoenix` chama o mesmo "ok" de novo a cada novo join). */
  reply(payload: unknown) {
    this.joinPush.trigger("ok", payload);
  }
  refuse(payload: unknown) {
    this.joinPush.trigger("error", payload);
  }
  push(event: string, payload: unknown) {
    this.handlers.get(event)?.(payload);
  }
  /** A conexão caiu: o `phoenix` marca o canal com erro e tenta de novo sozinho. */
  drop() {
    for (const callback of this.errorHandlers) callback();
  }
}

export class FakeSocket implements SocketLike {
  readonly channels: FakeChannel[] = [];
  channel(topic: string, params?: object) {
    const channel = new FakeChannel(topic, params);
    this.channels.push(channel);
    return channel;
  }
  get last(): FakeChannel {
    const channel = this.channels.at(-1);
    if (!channel) throw new Error("nenhum canal aberto");
    return channel;
  }
}
