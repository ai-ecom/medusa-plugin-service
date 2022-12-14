import { Router } from "express"
import middlewares from "../../../middleware"
import requireCustomerAuthentication from "@medusajs/medusa/dist/api/middlewares/require-customer-authentication"
import {
    transformBody,
    transformQuery,
} from "@medusajs/medusa/dist/api/middlewares"
import {
    defaultStoreOrdersFields,
    defaultStoreOrdersRelations,
} from "@medusajs/medusa/dist/api/routes/store/orders"
import { StoreGetCustomersCustomerOrdersParams } from "@medusajs/medusa/dist/api/routes/store/customers/list-orders"

const route = Router()

export default (app) => {
  app.use("/customers/me", route)

  // Authenticated endpoints
  route.use(requireCustomerAuthentication())
  route.get(
    "/orders/appointments",
    transformQuery(StoreGetCustomersCustomerOrdersParams, {
      defaultFields: defaultStoreOrdersFields,
      defaultRelations: defaultStoreOrdersRelations,
      isList: true,
    }),
    middlewares.wrap(require("./list-orders-with-appointments").default)
  )
  
  route.get("/orders/:id/appointments", middlewares.wrap(require("./get-orders-appointments").default))
  
  route.post("/make-appointment", middlewares.wrap(require("./make-appointment").default))

  return app
}

export * from "./get-orders-appointments"
export * from "./list-orders-with-appointments"
export * from "./make-appointment"