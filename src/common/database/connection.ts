import mongoose from 'mongoose';
import {createLogger} from '../logger';
import { env, environmentService } from '../environment';

const logger = createLogger('database');

export class DatabaseConnection {
	private static instance: DatabaseConnection;

	private constructor(){}

	public static getInstance(): DatabaseConnection {
		if(!DatabaseConnection.instance){
			DatabaseConnection.instance = new DatabaseConnection();
		}
		return DatabaseConnection.instance;
	}

	public async connect(): Promise<void> {
		try{
			mongoose.connection.on('connected', () => {
				logger.info('MongoDB connection established');
			});

			mongoose.connection.on('error', (err) => {
				logger.error('MongoDB connection error', {error: err.message});
			});

			mongoose.connection.on('disconnected', () => {
				logger.info('MongoDB connection disconnected');
			})

			const options = environmentService.getMongoDBOptions();
			await mongoose.connect(env.MONGODB_URI, options);

			logger.info('Connected to MongoDB', {
				uri: env.MONGODB_URI.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@'),
				environment: env.NODE_ENV
			})
		}catch(error: any){
			logger.error('Failed to connect to mongoDB', {error: error.message});
			throw error;
		}

	}

	public async disconnect(): Promise<void> {
		try{
			await mongoose.disconnect();
			logger.info('Disconnected from MongoDB');
		}catch(error: any){
			logger.error('Error disconnecting from MongoDB', { error: error.message });
      			throw error;
		}
	}
}

export const databaseConnection = DatabaseConnection.getInstance();
