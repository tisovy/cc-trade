// Force clear environment variables for E2E tests
process.env.BK = '';
process.env.BS = '';
process.env.FUTURES_READ_MODE = 'mock';
process.env.FUTURES_READ_MOCK_SCENARIO = 'one-way';
delete process.env.FUTURES_TESTNET_API_KEY;
delete process.env.FUTURES_TESTNET_API_SECRET;
console.log('E2E: Environment variables cleared');
