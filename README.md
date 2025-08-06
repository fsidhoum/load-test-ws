# Load Tester for WebSocket and HTTP

A Node.js application designed to test WebSocket and HTTP server capacity by simulating a large number of simultaneous connections or requests. This tool is particularly useful for testing servers deployed in Kubernetes clusters.

## Features

- Supports two test modes: WebSocket and HTTP
- Simulates multiple WebSocket connections or HTTP requests from a single container
- Supports all common HTTP methods (GET, POST, PUT, DELETE, etc.)
- Supports deploying multiple replicas via Docker Compose or Kubernetes
- Configurable connection modes: instant or progressive
- Tracks and reports connection statistics to InfluxDB time-series database
- Supports dynamic URL variables using test data from CSV files
- Automatic retry for failed connections
- Configurable logging levels
- Graceful shutdown handling

## Requirements

- Node.js 22 or higher
- InfluxDB 2.x server
- Redis server
- Docker and Docker Compose (for containerized deployment)

## Architecture

The application consists of two main modules:

1. **Data Loader Module**: Reads test data from CSV files, filters it based on level, and stores it in Redis.
2. **Runner Module**: Establishes WebSocket connections using dynamic URLs with variables from the test data.

The codebase is organized into two separate directories:
- `src/data-loader/`: Contains all code related to the data loader module
- `src/runner/`: Contains all code related to the WebSocket runner module

## Configuration

### Runner Service

The runner service is configured via environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `TEST_MODE` | Test mode to use (websocket or http) | websocket |
| `WS_URL` | WebSocket server URL to test (can include variables like `@{id}`) | *Required when TEST_MODE=websocket* |
| `HTTP_URL` | HTTP server URL to test (can include variables like `@{id}`) | *Required when TEST_MODE=http* |
| `HTTP_METHOD` | HTTP method to use (GET, POST, PUT, DELETE, etc.) | GET |
| `NUM_CONNECTIONS` | Number of connections/requests to establish (only used when no CSV data is loaded) | 100 |
| `REPLICAS` | Number of replicas of the service (used to calculate connections when CSV data is loaded) | 3 |
| `INFLUX_URL` | InfluxDB server URL | *Required* |
| `INFLUX_TOKEN` | InfluxDB authentication token | *Required* |
| `INFLUX_ORG` | InfluxDB organization name | *Required* |
| `INFLUX_BUCKET` | InfluxDB bucket name | *Required* |
| `REDIS_URL` | Redis server URL for test data | *Required* |
| `LOG_LEVEL` | Logging level (debug, info, warn, error) | info |
| `RETRY_DELAY_MS` | Delay between connection retry attempts (ms) | 5000 |
| `CONNECTION_MODE` | Connection mode (instant or progressive) | instant |
| `CONNECTION_RATE` | Connections per second in progressive mode | 10 |
| `RUNNER_ID` | Unique identifier for the runner | auto-generated |

### Data Loader Service

The data loader service is configured via environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `CSV_PATH` | Path to the CSV file with test data | *Required* |
| `REDIS_URL` | Redis server URL to store test data | *Required* |
| `DATA_LEVEL` | Maximum level value to filter CSV rows (rows with level <= DATA_LEVEL are included) | 999 |
| `LOG_LEVEL` | Logging level (debug, info, warn, error) | info |

## Using Dynamic URL Variables

The WebSocket Load Tester supports dynamic URL variables that are replaced with values from test data stored in Redis. This allows you to test WebSocket servers with different parameters for each connection.

### CSV File Format

The CSV file must have the following format:
- The first line contains column headers
- The first column must be named `level` (used for filtering)
- Other columns can have any name and will be available as variables

Example CSV file (`test-data.csv`):
```csv
level,id,token
1,abc123,token1
2,def456,token2
3,ghi789,token3
```

### URL Template Format

In the `WS_URL` environment variable, you can include variables from the CSV file using the `${variable}` syntax:

```
ws://your-websocket-server.com/ws?id=${id}&token=${token}
```

When a connection is established, the variables are replaced with values from a row popped from the Redis list. Each row is used only once and then removed from the list, ensuring that each connection uses unique test data.

For example, using the CSV data above, the URL might become:
```
ws://your-websocket-server.com/ws?id=def456&token=token2
```

### Connection Calculation

When CSV data is loaded into Redis, the number of WebSocket connections is automatically calculated based on the formula:

```
Number of connections = Total number of rows in Redis / Number of replicas
```

This ensures that all test data is evenly distributed across all replicas of the service. For example, if you have 1000 rows of test data and 5 replicas, each replica will create 200 connections.

If no CSV data is loaded, the service falls back to using the `NUM_CONNECTIONS` environment variable to determine how many connections to establish.

### Running the Data Loader

To load test data from a CSV file:

```
# Create a directory for test data
mkdir -p test-data

# Create a CSV file
cat > test-data/test-data.csv << EOF
level,id,token
1,abc123,token1
2,def456,token2
3,ghi789,token3
EOF

# Run the data loader
export CSV_PATH=./test-data/test-data.csv
export REDIS_URL=redis://localhost:6379
export DATA_LEVEL=2  # Only include rows with level <= 2
pnpm run data-loader
```

## Local Development

### Setup

1. Clone the repository
2. Install dependencies:
   ```
   pnpm install
   ```
3. Build the TypeScript code:
   ```
   pnpm run build
   ```

### Running Locally

1. Make sure InfluxDB and Redis are running and accessible
2. Load test data using the data-loader:
   ```
   export CSV_PATH=./test-data/test-data.csv
   export REDIS_URL=redis://localhost:6379
   export DATA_LEVEL=999
   pnpm run data-loader
   ```
3. Set the required environment variables for the runner:
   ```
   export WS_URL="ws://your-websocket-server.com/ws?id=@{id}&token=@{token}"
   export INFLUX_URL=http://localhost:8086
   export INFLUX_TOKEN=your-influxdb-token
   export INFLUX_ORG=your-organization
   export INFLUX_BUCKET=connection-stats
   export REDIS_URL=redis://localhost:6379
   ```
4. Run the runner module:
   ```
   pnpm run runner
   ```
   
   Or use the start script (which builds first):
   ```
   pnpm start
   ```

For development with auto-reload:
```
pnpm run dev
```

## Docker Deployment

### Building the Docker Image

```
docker build -t ws-load-tester .
```

### Running with Docker

```
docker run -e WS_URL=ws://your-websocket-server.com/ws \
  -e INFLUX_URL=http://influxdb-host:8086 \
  -e INFLUX_TOKEN=your-influxdb-token \
  -e INFLUX_ORG=your-organization \
  -e INFLUX_BUCKET=connection-stats \
  ws-load-tester
```

## Docker Compose Deployment

The included docker-compose.yml file allows you to deploy all services together:

### WebSocket Testing Example

```bash
# Create a directory for test data
mkdir -p test-data

# Create a CSV file
cat > test-data/test-data.csv << EOF
level,id,token
1,abc123,token1
2,def456,token2
3,ghi789,token3
EOF

# Set the test mode to WebSocket
export TEST_MODE=websocket

# Set the WebSocket server URL with variables
export WS_URL="ws://your-websocket-server.com/ws?id=@{id}&token=@{token}"

# Set the path to the CSV file
export CSV_PATH=./test-data

# Set the CSV filename
export CSV_FILE=test-data.csv

# Set the maximum level for filtering
export DATA_LEVEL=2

# Set the number of connections per container
export NUM_CONNECTIONS=500

# Set the number of replicas
export REPLICAS=5

# Start the services
docker-compose up -d
```

### HTTP Testing Example

```bash
# Create a directory for test data
mkdir -p test-data

# Create a CSV file
cat > test-data/test-data.csv << EOF
level,id,token,payload
1,abc123,token1,{"data":"test1"}
2,def456,token2,{"data":"test2"}
3,ghi789,token3,{"data":"test3"}
EOF

# Set the test mode to HTTP
export TEST_MODE=http

# Set the HTTP URL with variables
export HTTP_URL="https://your-api-server.com/api/resource/@{id}?token=@{token}"

# Set the HTTP method
export HTTP_METHOD=POST

# Set the path to the CSV file
export CSV_PATH=./test-data

# Set the CSV filename
export CSV_FILE=test-data.csv

# Set the maximum level for filtering
export DATA_LEVEL=2

# Set the number of requests per container
export NUM_CONNECTIONS=500

# Set the number of replicas
export REPLICAS=5

# Start the services
docker-compose up -d
```

This will start:
- An InfluxDB container for time-series statistics collection
- A Redis container for storing test data
- A data-loader container that reads the CSV file and stores data in Redis
- Multiple WebSocket load tester containers (5 in this example)
- Each container will establish 500 connections, for a total of 2,500 connections

### Scaling with Docker Compose

You can also scale the number of containers after deployment:

```
docker-compose up -d --scale ws-load-tester=10
```

### Using Your Own CSV Data

To use your own CSV data:

1. Create a CSV file with your test data (must include a `level` column)
2. Mount the directory containing your CSV file:
   ```
   export CSV_PATH=/path/to/your/data/directory
   export CSV_FILE=your-data.csv
   ```
3. Set the appropriate DATA_LEVEL to filter rows:
   ```
   export DATA_LEVEL=5  # Only include rows with level <= 5
   ```
4. Update the WS_URL to use variables from your CSV:
   ```
   export WS_URL="ws://your-server.com/ws?param1=\${column1}&param2=\${column2}"
   ```
5. Start the services:
   ```
   docker-compose up -d
   ```

## Monitoring

The application logs statistics to the console and to InfluxDB. You can monitor the data using the pre-configured dashboard, the InfluxDB UI, or by querying the API.

### Using the Pre-configured Dashboard

A comprehensive dashboard is automatically provisioned when you deploy the stack using docker-compose. This dashboard provides real-time visibility into your WebSocket connections:

1. Access the InfluxDB UI at `http://localhost:8086` (or your InfluxDB server address)
2. Log in with the credentials specified in the docker-compose.yml file (default: admin/adminpassword)
3. Navigate to "Dashboards" in the left sidebar
4. Select the "WebSocket Connection Statistics" dashboard

The dashboard includes the following visualizations:

- **Total Active Connections**: Shows the total number of active connections across all runners
- **Active Connections by Runner**: Breaks down active connections by individual runner
- **Active Connections Over Time**: Displays how connections change over time for each runner
- **Total Active Connections Over Time**: Shows the aggregate connection count across all runners
- **Connection Success Rate**: Displays the percentage of successful connections
- **Connection Errors**: Shows the total number of connection errors
- **Average Connection Time**: Displays the average time to establish a connection
- **Connection Events Over Time**: Shows connection events (attempts, opens, closes, errors) over time

### Using the InfluxDB UI

You can also explore the data directly using the Data Explorer:

1. Access the InfluxDB UI at `http://localhost:8086` (or your InfluxDB server address)
2. Navigate to "Data Explorer"
3. Select the bucket "connection-stats"
4. Build a query to view your connection statistics:
   - From: `websocket_connections`
   - Filter by: `runnerId` (to see a specific runner's data)
   - Filter by: `event_type` (to see specific event types like "summary", "open", "close", etc.)

### Using the InfluxDB API

You can also query the data programmatically using the InfluxDB API:

```bash
curl -G "http://localhost:8086/api/v2/query?org=your-org" \
  --header "Authorization: Token your-token" \
  --header "Content-Type: application/vnd.flux" \
  --data-urlencode "query=from(bucket:\"connection-stats\") |> range(start: -1h) |> filter(fn: (r) => r._measurement == \"websocket_connections\" and r.runnerId == \"your-runner-id\")"
```

Replace `your-org`, `your-token`, and `your-runner-id` with your actual values.

## Kubernetes Deployment

For Kubernetes deployment, you can use the Docker image with a Kubernetes deployment configuration. Example:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ws-load-tester
spec:
  replicas: 5
  selector:
    matchLabels:
      app: ws-load-tester
  template:
    metadata:
      labels:
        app: ws-load-tester
    spec:
      containers:
      - name: ws-load-tester
        image: ws-load-tester:latest
        env:
        - name: WS_URL
          value: "ws://your-websocket-server.com/ws"
        - name: NUM_CONNECTIONS
          value: "500"
        - name: INFLUX_URL
          value: "http://influxdb-service:8086"
        - name: INFLUX_TOKEN
          value: "your-influxdb-token"
        - name: INFLUX_ORG
          value: "your-organization"
        - name: INFLUX_BUCKET
          value: "connection-stats"
        - name: LOG_LEVEL
          value: "info"
        resources:
          limits:
            cpu: "0.5"
            memory: "512Mi"
          requests:
            cpu: "0.2"
            memory: "256Mi"
```

## License

MIT
