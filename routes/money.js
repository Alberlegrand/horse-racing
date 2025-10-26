// money.js
import express from "express";
import { wrap } from "../game.js";

const router = express.Router();

// POST /api/v1/money/ - retourne un solde fictif
router.post("/", (req, res) => {
  return res.json(wrap({ money: 5000 }));
});

export default router;
