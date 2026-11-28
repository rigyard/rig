import { addItem } from "./cart.ts";
import { checkout } from "./checkout.ts";
import { setStock, stockOf } from "./inventory.ts";
import { pointsOf } from "./loyalty.ts";

await setStock("mug", 2);
await addItem("c1", "mug", 1);
console.log("checkout:", await checkout("ada", "c1"));
console.log("mugs left:", await stockOf("mug"), "| ada points:", await pointsOf("ada"));
