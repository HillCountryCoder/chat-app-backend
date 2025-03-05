import http from "http";
import open from "open";

const MONGO_EXPRESS_URL = "http://localhost:8081";
const MAX_ATTEMPTS = 60;
const DELAY_BETWEEN_ATTEMPTS = 2000;

console.log("Waiting for Mongo Express to be ready...");

function checkMongoExpressReady(attempts = 0) {
  console.log(`Attempt ${attempts + 1}/${MAX_ATTEMPTS}`);

  if (attempts >= MAX_ATTEMPTS) {
    console.error(
      "Mongo Express did not become available. Please check docker logs.",
    );
    return;
  }

  http
    .get(MONGO_EXPRESS_URL, (res) => {
      console.log(`Status code: ${res.statusCode}`);

      // 401 means the server is running but requires authentication
      // This is actually a good sign! The server is up and responding.
      if (res.statusCode === 401 || res.statusCode === 200) {
        console.log("Mongo Express is ready! Opening browser...");
        open(MONGO_EXPRESS_URL);
      } else {
        setTimeout(
          () => checkMongoExpressReady(attempts + 1),
          DELAY_BETWEEN_ATTEMPTS,
        );
      }
    })
    .on("error", (error) => {
      console.log(`Connection error: ${error.message}`);
      setTimeout(
        () => checkMongoExpressReady(attempts + 1),
        DELAY_BETWEEN_ATTEMPTS,
      );
    });
}

// Start checking
checkMongoExpressReady();
