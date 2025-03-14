import {createLogger} from '../logger';
import { databaseConnection } from './connection';

import '../../models';

const logger = createLogger('database-init'); 

export async function initializeDatabase(): Promise<void> {
	try{
		await databaseConnection.connect();
		logger.info('Database initialized successfully');
	}
	catch(error: any){
		logger.error('Failed to initialize database', {error: error.message});
		throw error;
	}
}
