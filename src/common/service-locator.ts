/* eslint-disable @typescript-eslint/no-explicit-any */
// src/common/service-locator.ts
import { PresenceManager } from "../presence/presence-manager";
import { Server } from "socket.io";

export class ServiceLocator {
  private static instance: ServiceLocator;
  private services: Map<string, any> = new Map();

  private constructor() {}

  static getInstance(): ServiceLocator {
    if (!ServiceLocator.instance) {
      ServiceLocator.instance = new ServiceLocator();
    }
    return ServiceLocator.instance;
  }

  register<T>(name: string, service: T): void {
    this.services.set(name, service);
  }

  get<T>(name: string): T {
    const service = this.services.get(name);
    if (!service) {
      throw new Error(`Service '${name}' not found`);
    }
    return service as T;
  }

  has(name: string): boolean {
    return this.services.has(name);
  }

  // Type-safe getters for common services
  getPresenceManager(): PresenceManager {
    return this.get<PresenceManager>("presenceManager");
  }

  getSocketIO(): Server {
    return this.get<Server>("socketIO");
  }
}
