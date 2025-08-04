# WebSocket Load Tester

A Node.js application designed to test WebSocket server capacity by simulating a large number of simultaneous connections. This tool is particularly useful for testing WebSocket servers deployed in Kubernetes clusters.

## Features

- Simulates multiple WebSocket connections from a single container
- Supports deploying multiple replicas via Docker Compose or Kubernetes
- Configurable connection modes: instant or progressive
- Tracks and reports connection statistics to InfluxDB time-series database
- Automatic retry for failed connections
- Configurable logging levels
- Graceful shutdown handling

## Requirements

- Node.js 22 or higher
- InfluxDB 2.x server
- Docker and Docker Compose (for containerized deployment)

## Configuration

The application is configured via environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `WS_URL` | WebSocket server URL to test | *Required* |
| `NUM_CONNECTIONS` | Number of WebSocket connections to establish | 100 |
| `INFLUX_URL` | InfluxDB server URL | *Required* |
| `INFLUX_TOKEN` | InfluxDB authentication token | *Required* |
| `INFLUX_ORG` | InfluxDB organization name | *Required* |
| `INFLUX_BUCKET` | InfluxDB bucket name | *Required* |
| `LOG_LEVEL` | Logging level (debug, info, warn, error) | info |
| `RETRY_DELAY_MS` | Delay between connection retry attempts (ms) | 5000 |
| `CONNECTION_MODE` | Connection mode (instant or progressive) | instant |
| `CONNECTION_RATE` | Connections per second in progressive mode | 10 |
| `RUNNER_ID` | Unique identifier for the runner | auto-generated |

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

1. Make sure InfluxDB is running and accessible
2. Set the required environment variables:
   ```
   export WS_URL=ws://your-websocket-server.com/ws
   export INFLUX_URL=http://localhost:8086
   export INFLUX_TOKEN=your-influxdb-token
   export INFLUX_ORG=your-organization
   export INFLUX_BUCKET=connection-stats
   ```
3. Run the application:
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

The included docker-compose.yml file allows you to deploy multiple replicas of the load tester along with InfluxDB:

```
# Set the WebSocket server URL
export WS_URL=ws://your-websocket-server.com/ws

# Set the number of connections per container
export NUM_CONNECTIONS=500

# Set the number of replicas
export REPLICAS=5

# Start the services
docker-compose up -d
```

This will start:
- An InfluxDB container for time-series statistics collection
- Multiple WebSocket load tester containers (5 in this example)
- Each container will establish 500 connections, for a total of 2,500 connections

### Scaling with Docker Compose

You can also scale the number of containers after deployment:

```
docker-compose up -d --scale ws-load-tester=10
```

## Monitoring

The application logs statistics to the console and to InfluxDB. You can monitor the data using the InfluxDB UI or by querying the API.

### Using the InfluxDB UI

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
