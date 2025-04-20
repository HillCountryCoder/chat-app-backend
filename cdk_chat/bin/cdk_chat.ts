#!/usr/bin/env node
import "source-map-support/register";
import { ChatBackendApp } from "../lib/app";
import { Configuration } from "../lib/config";

// Initialize configuration
Configuration.init();

// Create and initialize the app
const app = new ChatBackendApp({});

app.synth();
