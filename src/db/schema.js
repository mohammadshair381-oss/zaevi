/**
 * Every collection, its fields, relationships and indexes. This is the single definition
 * that the Mongoose models, the data client and `npm run db:setup` are all built from.
 *
 * Relationships: `local` is the field on this model holding the other record's id, with
 * `onDelete` saying what happens when that record is deleted. `foreign` is the field on the
 * other model pointing back here. MongoDB enforces neither, so src/db/client.js does.
 */
export const MODELS = {
  Product: {
    collection: 'products',
    id: 'id',
    autoIncrement: false,
    fields: {
      name: {
        type: 'string',
        required: true,
        maxLength: 200
      },
      category: {
        type: 'string',
        required: true,
        maxLength: 100
      },
      gender: {
        type: 'string',
        required: true,
        maxLength: 20
      },
      price: {
        type: 'int',
        required: true,
        min: 0
      },
      color: {
        type: 'string',
        required: true,
        maxLength: 50
      },
      imageUrl: {
        type: 'string',
        required: true,
        maxLength: 1024
      },
      hoverImageUrl: {
        type: 'string',
        required: true,
        maxLength: 1024
      },
      description: {
        type: 'string',
        required: true,
        maxLength: 65535
      },
      available: {
        type: 'boolean',
        required: true,
        default: true
      },
      createdAt: {
        type: 'date',
        required: true,
        defaultNow: true
      },
      updatedAt: {
        type: 'date',
        required: true,
        updatedAt: true
      }
    },
    relations: {
      sizes: {
        model: 'ProductSize',
        many: true,
        foreign: 'productId'
      },
      orderItems: {
        model: 'OrderItem',
        many: true,
        foreign: 'productId'
      },
      reviews: {
        model: 'Review',
        many: true,
        foreign: 'productId'
      }
    },
    indexes: [
      {
        fields: [
          'category'
        ],
        unique: false,
        name: 'Product_category_idx'
      },
      {
        fields: [
          'gender'
        ],
        unique: false,
        name: 'Product_gender_idx'
      },
      {
        fields: [
          'available'
        ],
        unique: false,
        name: 'Product_available_idx'
      }
    ],
    idType: 'string',
    idMaxLength: 32
  },
  ProductSize: {
    collection: 'productSizes',
    id: 'id',
    autoIncrement: true,
    fields: {
      productId: {
        type: 'string',
        required: true,
        maxLength: 32
      },
      size: {
        type: 'string',
        required: true,
        maxLength: 20
      },
      position: {
        type: 'int',
        required: true,
        min: 0
      },
      stock: {
        type: 'int',
        required: false,
        min: 0,
        hidden: true
      }
    },
    relations: {
      product: {
        model: 'Product',
        many: false,
        local: 'productId',
        onDelete: 'Cascade'
      }
    },
    indexes: [
      {
        fields: [
          'productId',
          'size'
        ],
        unique: true,
        name: 'ProductSize_productId_size_key'
      },
      {
        fields: [
          'productId'
        ],
        unique: false,
        name: 'ProductSize_productId_idx'
      }
    ],
    idType: 'int'
  },
  Customer: {
    collection: 'customers',
    id: 'id',
    autoIncrement: true,
    fields: {
      email: {
        type: 'string',
        required: true,
        maxLength: 255
      },
      name: {
        type: 'string',
        required: false,
        maxLength: 200
      },
      phone: {
        type: 'string',
        required: false,
        maxLength: 32
      },
      passwordHash: {
        type: 'string',
        required: false,
        maxLength: 255
      },
      emailVerifiedAt: {
        type: 'date',
        required: false
      },
      role: {
        type: 'string',
        required: true,
        maxLength: 20,
        default: 'customer'
      },
      createdAt: {
        type: 'date',
        required: true,
        defaultNow: true
      },
      updatedAt: {
        type: 'date',
        required: true,
        updatedAt: true
      }
    },
    relations: {
      orders: {
        model: 'Order',
        many: true,
        foreign: 'customerId'
      },
      addresses: {
        model: 'Address',
        many: true,
        foreign: 'customerId'
      },
      updatedWebsiteSettings: {
        model: 'WebsiteSetting',
        many: true,
        foreign: 'updatedBy'
      },
      authoredCmsRevisions: {
        model: 'CmsPageRevision',
        many: true,
        foreign: 'createdBy'
      },
      uploadedMediaAssets: {
        model: 'MediaAsset',
        many: true,
        foreign: 'createdBy'
      },
      reviews: {
        model: 'Review',
        many: true,
        foreign: 'customerId'
      },
      notifications: {
        model: 'Notification',
        many: true,
        foreign: 'customerId'
      },
      couponUsages: {
        model: 'CouponUsage',
        many: true,
        foreign: 'customerId'
      },
      deliveryConfigs: {
        model: 'DeliveryEstimateConfig',
        many: true,
        foreign: 'updatedBy'
      },
      cancellationRequestsRequested: {
        model: 'CancellationRequest',
        many: true,
        foreign: 'requestedBy'
      },
      cancellationRequestsDecided: {
        model: 'CancellationRequest',
        many: true,
        foreign: 'decidedBy'
      },
      returnRequestsRequested: {
        model: 'ReturnRequest',
        many: true,
        foreign: 'requestedBy'
      },
      returnRequestsDecided: {
        model: 'ReturnRequest',
        many: true,
        foreign: 'decidedBy'
      },
      replacementRequestsRequested: {
        model: 'ReplacementRequest',
        many: true,
        foreign: 'requestedBy'
      },
      replacementRequestsDecided: {
        model: 'ReplacementRequest',
        many: true,
        foreign: 'decidedBy'
      },
      statusHistoryChanges: {
        model: 'OrderStatusHistory',
        many: true,
        foreign: 'changedBy'
      },
      passwordResetTokens: {
        model: 'PasswordResetToken',
        many: true,
        foreign: 'customerId'
      },
      emailOtps: {
        model: 'EmailOtp',
        many: true,
        foreign: 'customerId'
      }
    },
    indexes: [
      {
        fields: [
          'email'
        ],
        unique: true,
        name: 'Customer_email_key'
      }
    ],
    idType: 'int'
  },
  Address: {
    collection: 'addresses',
    id: 'id',
    autoIncrement: true,
    fields: {
      customerId: {
        type: 'int',
        required: true
      },
      fullName: {
        type: 'string',
        required: true,
        maxLength: 200
      },
      phone: {
        type: 'string',
        required: true,
        maxLength: 32
      },
      addressLine1: {
        type: 'string',
        required: true,
        maxLength: 500
      },
      addressLine2: {
        type: 'string',
        required: false,
        maxLength: 500
      },
      landmark: {
        type: 'string',
        required: false,
        maxLength: 200
      },
      locality: {
        type: 'string',
        required: false,
        maxLength: 200
      },
      city: {
        type: 'string',
        required: true,
        maxLength: 120
      },
      state: {
        type: 'string',
        required: true,
        maxLength: 120
      },
      postalCode: {
        type: 'string',
        required: true,
        maxLength: 20
      },
      country: {
        type: 'string',
        required: true,
        maxLength: 2,
        default: 'IN'
      },
      label: {
        type: 'string',
        required: false,
        maxLength: 50
      },
      isDefault: {
        type: 'boolean',
        required: true,
        default: false
      },
      createdAt: {
        type: 'date',
        required: true,
        defaultNow: true
      },
      updatedAt: {
        type: 'date',
        required: true,
        updatedAt: true
      }
    },
    relations: {
      customer: {
        model: 'Customer',
        many: false,
        local: 'customerId',
        onDelete: 'Cascade'
      }
    },
    indexes: [
      {
        fields: [
          'customerId'
        ],
        unique: false,
        name: 'Address_customerId_idx'
      },
      {
        fields: [
          'customerId',
          'isDefault'
        ],
        unique: false,
        name: 'Address_customerId_isDefault_idx'
      }
    ],
    idType: 'int'
  },
  Order: {
    collection: 'orders',
    id: 'id',
    autoIncrement: true,
    fields: {
      reference: {
        type: 'string',
        required: true,
        maxLength: 32
      },
      idempotencyKey: {
        type: 'string',
        required: false,
        maxLength: 64
      },
      idempotencyHash: {
        type: 'string',
        required: false,
        maxLength: 64
      },
      customerId: {
        type: 'int',
        required: false
      },
      status: {
        type: 'string',
        required: true,
        maxLength: 20,
        default: 'pending'
      },
      currency: {
        type: 'string',
        required: true,
        maxLength: 3,
        default: 'INR'
      },
      subtotalMinor: {
        type: 'int',
        required: true,
        min: 0
      },
      discountMinor: {
        type: 'int',
        required: true,
        min: 0,
        default: 0
      },
      totalMinor: {
        type: 'int',
        required: true,
        min: 0
      },
      couponId: {
        type: 'int',
        required: false
      },
      notes: {
        type: 'string',
        required: false,
        maxLength: 500
      },
      contactEmail: {
        type: 'string',
        required: true,
        maxLength: 255
      },
      contactPhone: {
        type: 'string',
        required: false,
        maxLength: 32
      },
      shippingName: {
        type: 'string',
        required: false,
        maxLength: 200
      },
      shippingAddress: {
        type: 'string',
        required: false,
        maxLength: 500
      },
      shippingCity: {
        type: 'string',
        required: false,
        maxLength: 120
      },
      shippingPostalCode: {
        type: 'string',
        required: false,
        maxLength: 20
      },
      shippingCountry: {
        type: 'string',
        required: true,
        maxLength: 2,
        default: 'IN'
      },
      estimatedDispatchAt: {
        type: 'date',
        required: false
      },
      estimatedProductionCompleteAt: {
        type: 'date',
        required: false
      },
      createdAt: {
        type: 'date',
        required: true,
        defaultNow: true
      },
      updatedAt: {
        type: 'date',
        required: true,
        updatedAt: true
      }
    },
    relations: {
      customer: {
        model: 'Customer',
        many: false,
        local: 'customerId',
        onDelete: 'SetNull'
      },
      coupon: {
        model: 'Coupon',
        many: false,
        local: 'couponId',
        onDelete: 'SetNull'
      },
      items: {
        model: 'OrderItem',
        many: true,
        foreign: 'orderId'
      },
      payments: {
        model: 'Payment',
        many: true,
        foreign: 'orderId'
      },
      statusHistory: {
        model: 'OrderStatusHistory',
        many: true,
        foreign: 'orderId'
      },
      shipments: {
        model: 'Shipment',
        many: true,
        foreign: 'orderId'
      },
      cancellationRequest: {
        model: 'CancellationRequest',
        many: false,
        foreign: 'orderId'
      },
      returnRequests: {
        model: 'ReturnRequest',
        many: true,
        foreign: 'orderId'
      },
      replacementRequests: {
        model: 'ReplacementRequest',
        many: true,
        foreign: 'orderId'
      },
      couponUsages: {
        model: 'CouponUsage',
        many: true,
        foreign: 'orderId'
      }
    },
    indexes: [
      {
        fields: [
          'reference'
        ],
        unique: true,
        name: 'Order_reference_key'
      },
      {
        fields: [
          'idempotencyKey'
        ],
        unique: true,
        name: 'Order_idempotencyKey_key'
      },
      {
        fields: [
          'customerId'
        ],
        unique: false,
        name: 'Order_customerId_idx'
      },
      {
        fields: [
          'status'
        ],
        unique: false,
        name: 'Order_status_idx'
      },
      {
        fields: [
          'createdAt'
        ],
        unique: false,
        name: 'Order_createdAt_idx'
      },
      {
        fields: [
          'couponId'
        ],
        unique: false,
        name: 'Order_couponId_fkey'
      }
    ],
    idType: 'int'
  },
  OrderItem: {
    collection: 'orderItems',
    id: 'id',
    autoIncrement: true,
    fields: {
      orderId: {
        type: 'int',
        required: true
      },
      productId: {
        type: 'string',
        required: false,
        maxLength: 32
      },
      productSku: {
        type: 'string',
        required: true,
        maxLength: 32
      },
      productName: {
        type: 'string',
        required: true,
        maxLength: 200
      },
      size: {
        type: 'string',
        required: false,
        maxLength: 20
      },
      unitPriceMinor: {
        type: 'int',
        required: true,
        min: 0
      },
      quantity: {
        type: 'int',
        required: true,
        min: 0
      },
      lineTotalMinor: {
        type: 'int',
        required: true,
        min: 0
      },
      createdAt: {
        type: 'date',
        required: true,
        defaultNow: true
      }
    },
    relations: {
      order: {
        model: 'Order',
        many: false,
        local: 'orderId',
        onDelete: 'Cascade'
      },
      product: {
        model: 'Product',
        many: false,
        local: 'productId',
        onDelete: 'SetNull'
      },
      returnItems: {
        model: 'ReturnItem',
        many: true,
        foreign: 'orderItemId'
      },
      replacementItems: {
        model: 'ReplacementItem',
        many: true,
        foreign: 'orderItemId'
      }
    },
    indexes: [
      {
        fields: [
          'orderId'
        ],
        unique: false,
        name: 'OrderItem_orderId_idx'
      },
      {
        fields: [
          'productId'
        ],
        unique: false,
        name: 'OrderItem_productId_idx'
      }
    ],
    idType: 'int'
  },
  OrderStatusHistory: {
    collection: 'orderStatusHistory',
    id: 'id',
    autoIncrement: true,
    fields: {
      orderId: {
        type: 'int',
        required: true
      },
      previousStatus: {
        type: 'string',
        required: false,
        maxLength: 20
      },
      newStatus: {
        type: 'string',
        required: true,
        maxLength: 20
      },
      note: {
        type: 'string',
        required: false,
        maxLength: 500
      },
      visibility: {
        type: 'string',
        required: true,
        maxLength: 20,
        default: 'customer'
      },
      changedBy: {
        type: 'int',
        required: false
      },
      changedByEmail: {
        type: 'string',
        required: false,
        maxLength: 255
      },
      createdAt: {
        type: 'date',
        required: true,
        defaultNow: true
      }
    },
    relations: {
      order: {
        model: 'Order',
        many: false,
        local: 'orderId',
        onDelete: 'Cascade'
      },
      customer: {
        model: 'Customer',
        many: false,
        local: 'changedBy',
        onDelete: 'SetNull'
      }
    },
    indexes: [
      {
        fields: [
          'orderId',
          'createdAt'
        ],
        unique: false,
        name: 'OrderStatusHistory_orderId_createdAt_idx'
      },
      {
        fields: [
          'changedBy'
        ],
        unique: false,
        name: 'OrderStatusHistory_changedBy_idx'
      }
    ],
    idType: 'int'
  },
  Shipment: {
    collection: 'shipments',
    id: 'id',
    autoIncrement: true,
    fields: {
      orderId: {
        type: 'int',
        required: true
      },
      type: {
        type: 'string',
        required: true,
        maxLength: 20,
        default: 'outbound'
      },
      carrier: {
        type: 'string',
        required: false,
        maxLength: 120
      },
      trackingNumber: {
        type: 'string',
        required: false,
        maxLength: 120
      },
      trackingUrl: {
        type: 'string',
        required: false,
        maxLength: 1024
      },
      dispatchedAt: {
        type: 'date',
        required: false
      },
      estimatedDeliveryAt: {
        type: 'date',
        required: false
      },
      deliveredAt: {
        type: 'date',
        required: false
      },
      createdAt: {
        type: 'date',
        required: true,
        defaultNow: true
      },
      updatedAt: {
        type: 'date',
        required: true,
        updatedAt: true
      }
    },
    relations: {
      order: {
        model: 'Order',
        many: false,
        local: 'orderId',
        onDelete: 'Cascade'
      },
      returnRequest: {
        model: 'ReturnRequest',
        many: false,
        foreign: 'returnShipmentId'
      },
      replacementRequest: {
        model: 'ReplacementRequest',
        many: false,
        foreign: 'replacementShipmentId'
      }
    },
    indexes: [
      {
        fields: [
          'orderId',
          'type'
        ],
        unique: false,
        name: 'Shipment_orderId_type_idx'
      },
      {
        fields: [
          'trackingNumber'
        ],
        unique: false,
        name: 'Shipment_trackingNumber_idx'
      }
    ],
    idType: 'int'
  },
  DeliveryEstimateConfig: {
    collection: 'deliveryEstimateConfigs',
    id: 'id',
    autoIncrement: false,
    fields: {
      productionDays: {
        type: 'int',
        required: true,
        default: 0
      },
      qualityCheckDays: {
        type: 'int',
        required: true,
        default: 0
      },
      packingDays: {
        type: 'int',
        required: true,
        default: 0
      },
      shippingDays: {
        type: 'int',
        required: true,
        default: 0
      },
      bufferDays: {
        type: 'int',
        required: true,
        default: 0
      },
      updatedAt: {
        type: 'date',
        required: true,
        updatedAt: true
      },
      updatedBy: {
        type: 'int',
        required: false
      },
      updatedByEmail: {
        type: 'string',
        required: false,
        maxLength: 255
      }
    },
    relations: {
      customer: {
        model: 'Customer',
        many: false,
        local: 'updatedBy',
        onDelete: 'SetNull'
      }
    },
    indexes: [
      {
        fields: [
          'updatedBy'
        ],
        unique: false,
        name: 'DeliveryEstimateConfig_updatedBy_fkey'
      }
    ],
    idType: 'int',
    idDefault: 1
  },
  CancellationRequest: {
    collection: 'cancellationRequests',
    id: 'id',
    autoIncrement: true,
    fields: {
      orderId: {
        type: 'int',
        required: true
      },
      reason: {
        type: 'string',
        required: true,
        maxLength: 500
      },
      status: {
        type: 'string',
        required: true,
        maxLength: 20,
        default: 'pending'
      },
      idempotencyKey: {
        type: 'string',
        required: false,
        maxLength: 64
      },
      requestedBy: {
        type: 'int',
        required: false
      },
      requesterEmail: {
        type: 'string',
        required: false,
        maxLength: 255
      },
      decidedBy: {
        type: 'int',
        required: false
      },
      deciderEmail: {
        type: 'string',
        required: false,
        maxLength: 255
      },
      decidedAt: {
        type: 'date',
        required: false
      },
      createdAt: {
        type: 'date',
        required: true,
        defaultNow: true
      },
      updatedAt: {
        type: 'date',
        required: true,
        updatedAt: true
      }
    },
    relations: {
      order: {
        model: 'Order',
        many: false,
        local: 'orderId',
        onDelete: 'Cascade'
      },
      requester: {
        model: 'Customer',
        many: false,
        local: 'requestedBy',
        onDelete: 'SetNull'
      },
      decider: {
        model: 'Customer',
        many: false,
        local: 'decidedBy',
        onDelete: 'SetNull'
      }
    },
    indexes: [
      {
        fields: [
          'orderId'
        ],
        unique: true,
        name: 'CancellationRequest_orderId_key'
      },
      {
        fields: [
          'idempotencyKey'
        ],
        unique: true,
        name: 'CancellationRequest_idempotencyKey_key'
      },
      {
        fields: [
          'status'
        ],
        unique: false,
        name: 'CancellationRequest_status_idx'
      },
      {
        fields: [
          'requestedBy'
        ],
        unique: false,
        name: 'CancellationRequest_requestedBy_fkey'
      },
      {
        fields: [
          'decidedBy'
        ],
        unique: false,
        name: 'CancellationRequest_decidedBy_fkey'
      }
    ],
    idType: 'int'
  },
  ReturnRequest: {
    collection: 'returnRequests',
    id: 'id',
    autoIncrement: true,
    fields: {
      orderId: {
        type: 'int',
        required: true
      },
      reason: {
        type: 'string',
        required: true,
        maxLength: 500
      },
      status: {
        type: 'string',
        required: true,
        maxLength: 20,
        default: 'pending'
      },
      refundStatus: {
        type: 'string',
        required: true,
        maxLength: 20,
        default: 'not_applicable'
      },
      idempotencyKey: {
        type: 'string',
        required: false,
        maxLength: 64
      },
      requestedBy: {
        type: 'int',
        required: false
      },
      requesterEmail: {
        type: 'string',
        required: false,
        maxLength: 255
      },
      decidedBy: {
        type: 'int',
        required: false
      },
      deciderEmail: {
        type: 'string',
        required: false,
        maxLength: 255
      },
      decidedAt: {
        type: 'date',
        required: false
      },
      receivedAt: {
        type: 'date',
        required: false
      },
      returnShipmentId: {
        type: 'int',
        required: false
      },
      createdAt: {
        type: 'date',
        required: true,
        defaultNow: true
      },
      updatedAt: {
        type: 'date',
        required: true,
        updatedAt: true
      }
    },
    relations: {
      order: {
        model: 'Order',
        many: false,
        local: 'orderId',
        onDelete: 'Cascade'
      },
      requester: {
        model: 'Customer',
        many: false,
        local: 'requestedBy',
        onDelete: 'SetNull'
      },
      decider: {
        model: 'Customer',
        many: false,
        local: 'decidedBy',
        onDelete: 'SetNull'
      },
      returnShipment: {
        model: 'Shipment',
        many: false,
        local: 'returnShipmentId',
        onDelete: 'SetNull'
      },
      items: {
        model: 'ReturnItem',
        many: true,
        foreign: 'returnRequestId'
      }
    },
    indexes: [
      {
        fields: [
          'idempotencyKey'
        ],
        unique: true,
        name: 'ReturnRequest_idempotencyKey_key'
      },
      {
        fields: [
          'returnShipmentId'
        ],
        unique: true,
        name: 'ReturnRequest_returnShipmentId_key'
      },
      {
        fields: [
          'orderId',
          'status'
        ],
        unique: false,
        name: 'ReturnRequest_orderId_status_idx'
      },
      {
        fields: [
          'requestedBy'
        ],
        unique: false,
        name: 'ReturnRequest_requestedBy_fkey'
      },
      {
        fields: [
          'decidedBy'
        ],
        unique: false,
        name: 'ReturnRequest_decidedBy_fkey'
      }
    ],
    idType: 'int'
  },
  ReturnItem: {
    collection: 'returnItems',
    id: 'id',
    autoIncrement: true,
    fields: {
      returnRequestId: {
        type: 'int',
        required: true
      },
      orderItemId: {
        type: 'int',
        required: true
      },
      quantity: {
        type: 'int',
        required: true,
        min: 0
      },
      createdAt: {
        type: 'date',
        required: true,
        defaultNow: true
      }
    },
    relations: {
      returnRequest: {
        model: 'ReturnRequest',
        many: false,
        local: 'returnRequestId',
        onDelete: 'Cascade'
      },
      orderItem: {
        model: 'OrderItem',
        many: false,
        local: 'orderItemId',
        onDelete: 'Cascade'
      }
    },
    indexes: [
      {
        fields: [
          'returnRequestId',
          'orderItemId'
        ],
        unique: true,
        name: 'ReturnItem_returnRequestId_orderItemId_key'
      },
      {
        fields: [
          'returnRequestId'
        ],
        unique: false,
        name: 'ReturnItem_returnRequestId_idx'
      },
      {
        fields: [
          'orderItemId'
        ],
        unique: false,
        name: 'ReturnItem_orderItemId_fkey'
      }
    ],
    idType: 'int'
  },
  ReplacementRequest: {
    collection: 'replacementRequests',
    id: 'id',
    autoIncrement: true,
    fields: {
      orderId: {
        type: 'int',
        required: true
      },
      reason: {
        type: 'string',
        required: true,
        maxLength: 500
      },
      status: {
        type: 'string',
        required: true,
        maxLength: 20,
        default: 'pending'
      },
      idempotencyKey: {
        type: 'string',
        required: false,
        maxLength: 64
      },
      requestedBy: {
        type: 'int',
        required: false
      },
      requesterEmail: {
        type: 'string',
        required: false,
        maxLength: 255
      },
      decidedBy: {
        type: 'int',
        required: false
      },
      deciderEmail: {
        type: 'string',
        required: false,
        maxLength: 255
      },
      decidedAt: {
        type: 'date',
        required: false
      },
      replacementShipmentId: {
        type: 'int',
        required: false
      },
      createdAt: {
        type: 'date',
        required: true,
        defaultNow: true
      },
      updatedAt: {
        type: 'date',
        required: true,
        updatedAt: true
      }
    },
    relations: {
      order: {
        model: 'Order',
        many: false,
        local: 'orderId',
        onDelete: 'Cascade'
      },
      requester: {
        model: 'Customer',
        many: false,
        local: 'requestedBy',
        onDelete: 'SetNull'
      },
      decider: {
        model: 'Customer',
        many: false,
        local: 'decidedBy',
        onDelete: 'SetNull'
      },
      replacementShipment: {
        model: 'Shipment',
        many: false,
        local: 'replacementShipmentId',
        onDelete: 'SetNull'
      },
      items: {
        model: 'ReplacementItem',
        many: true,
        foreign: 'replacementRequestId'
      }
    },
    indexes: [
      {
        fields: [
          'idempotencyKey'
        ],
        unique: true,
        name: 'ReplacementRequest_idempotencyKey_key'
      },
      {
        fields: [
          'replacementShipmentId'
        ],
        unique: true,
        name: 'ReplacementRequest_replacementShipmentId_key'
      },
      {
        fields: [
          'orderId',
          'status'
        ],
        unique: false,
        name: 'ReplacementRequest_orderId_status_idx'
      },
      {
        fields: [
          'requestedBy'
        ],
        unique: false,
        name: 'ReplacementRequest_requestedBy_fkey'
      },
      {
        fields: [
          'decidedBy'
        ],
        unique: false,
        name: 'ReplacementRequest_decidedBy_fkey'
      }
    ],
    idType: 'int'
  },
  ReplacementItem: {
    collection: 'replacementItems',
    id: 'id',
    autoIncrement: true,
    fields: {
      replacementRequestId: {
        type: 'int',
        required: true
      },
      orderItemId: {
        type: 'int',
        required: true
      },
      quantity: {
        type: 'int',
        required: true,
        min: 0
      },
      createdAt: {
        type: 'date',
        required: true,
        defaultNow: true
      }
    },
    relations: {
      replacementRequest: {
        model: 'ReplacementRequest',
        many: false,
        local: 'replacementRequestId',
        onDelete: 'Cascade'
      },
      orderItem: {
        model: 'OrderItem',
        many: false,
        local: 'orderItemId',
        onDelete: 'Cascade'
      }
    },
    indexes: [
      {
        fields: [
          'replacementRequestId',
          'orderItemId'
        ],
        unique: true,
        name: 'ReplacementItem_replacementRequestId_orderItemId_key'
      },
      {
        fields: [
          'replacementRequestId'
        ],
        unique: false,
        name: 'ReplacementItem_replacementRequestId_idx'
      },
      {
        fields: [
          'orderItemId'
        ],
        unique: false,
        name: 'ReplacementItem_orderItemId_fkey'
      }
    ],
    idType: 'int'
  },
  Coupon: {
    collection: 'coupons',
    id: 'id',
    autoIncrement: true,
    fields: {
      code: {
        type: 'string',
        required: true,
        maxLength: 32
      },
      description: {
        type: 'string',
        required: false,
        maxLength: 255
      },
      discountType: {
        type: 'string',
        required: true,
        maxLength: 20,
        default: 'percentage'
      },
      discountValue: {
        type: 'int',
        required: true,
        min: 0
      },
      minOrderMinor: {
        type: 'int',
        required: true,
        min: 0,
        default: 0
      },
      maxDiscountMinor: {
        type: 'int',
        required: false,
        min: 0
      },
      startsAt: {
        type: 'date',
        required: false
      },
      expiresAt: {
        type: 'date',
        required: false
      },
      usageLimit: {
        type: 'int',
        required: false,
        min: 0
      },
      usedCount: {
        type: 'int',
        required: true,
        min: 0,
        default: 0
      },
      perCustomerLimit: {
        type: 'int',
        required: false,
        min: 0
      },
      requiresNewsletter: {
        type: 'boolean',
        required: true,
        default: false
      },
      isActive: {
        type: 'boolean',
        required: true,
        default: true
      },
      createdAt: {
        type: 'date',
        required: true,
        defaultNow: true
      },
      updatedAt: {
        type: 'date',
        required: true,
        updatedAt: true
      }
    },
    relations: {
      orders: {
        model: 'Order',
        many: true,
        foreign: 'couponId'
      },
      usages: {
        model: 'CouponUsage',
        many: true,
        foreign: 'couponId'
      }
    },
    indexes: [
      {
        fields: [
          'code'
        ],
        unique: true,
        name: 'Coupon_code_key'
      },
      {
        fields: [
          'isActive'
        ],
        unique: false,
        name: 'Coupon_isActive_idx'
      }
    ],
    idType: 'int'
  },
  CouponUsage: {
    collection: 'couponUsages',
    id: 'id',
    autoIncrement: true,
    fields: {
      couponId: {
        type: 'int',
        required: true
      },
      orderId: {
        type: 'int',
        required: true
      },
      customerId: {
        type: 'int',
        required: false
      },
      discountAmountMinor: {
        type: 'int',
        required: true,
        min: 0
      },
      createdAt: {
        type: 'date',
        required: true,
        defaultNow: true
      }
    },
    relations: {
      coupon: {
        model: 'Coupon',
        many: false,
        local: 'couponId',
        onDelete: 'Cascade'
      },
      order: {
        model: 'Order',
        many: false,
        local: 'orderId',
        onDelete: 'Cascade'
      },
      customer: {
        model: 'Customer',
        many: false,
        local: 'customerId',
        onDelete: 'SetNull'
      }
    },
    indexes: [
      {
        fields: [
          'couponId'
        ],
        unique: false,
        name: 'CouponUsage_couponId_idx'
      },
      {
        fields: [
          'orderId'
        ],
        unique: false,
        name: 'CouponUsage_orderId_idx'
      },
      {
        fields: [
          'customerId'
        ],
        unique: false,
        name: 'CouponUsage_customerId_idx'
      }
    ],
    idType: 'int'
  },
  Review: {
    collection: 'reviews',
    id: 'id',
    autoIncrement: true,
    fields: {
      productId: {
        type: 'string',
        required: true,
        maxLength: 32
      },
      customerId: {
        type: 'int',
        required: false
      },
      authorName: {
        type: 'string',
        required: true,
        maxLength: 120
      },
      rating: {
        type: 'int',
        required: true,
        min: 0,
        max: 255
      },
      title: {
        type: 'string',
        required: false,
        maxLength: 200
      },
      content: {
        type: 'string',
        required: true,
        maxLength: 65535
      },
      status: {
        type: 'string',
        required: true,
        maxLength: 20,
        default: 'pending'
      },
      verifiedPurchase: {
        type: 'boolean',
        required: true,
        default: false
      },
      helpfulCount: {
        type: 'int',
        required: true,
        min: 0,
        default: 0
      },
      createdAt: {
        type: 'date',
        required: true,
        defaultNow: true
      },
      updatedAt: {
        type: 'date',
        required: true,
        updatedAt: true
      }
    },
    relations: {
      product: {
        model: 'Product',
        many: false,
        local: 'productId',
        onDelete: 'Cascade'
      },
      customer: {
        model: 'Customer',
        many: false,
        local: 'customerId',
        onDelete: 'SetNull'
      }
    },
    indexes: [
      {
        fields: [
          'productId',
          'status'
        ],
        unique: false,
        name: 'Review_productId_status_idx'
      },
      {
        fields: [
          'customerId'
        ],
        unique: false,
        name: 'Review_customerId_idx'
      }
    ],
    idType: 'int'
  },
  NewsletterSubscriber: {
    collection: 'newsletterSubscribers',
    id: 'id',
    autoIncrement: true,
    fields: {
      email: {
        type: 'string',
        required: true,
        maxLength: 255
      },
      status: {
        type: 'string',
        required: true,
        maxLength: 20,
        default: 'subscribed'
      },
      subscribedAt: {
        type: 'date',
        required: true,
        defaultNow: true
      },
      unsubscribedAt: {
        type: 'date',
        required: false
      }
    },
    relations: {},
    indexes: [
      {
        fields: [
          'email'
        ],
        unique: true,
        name: 'NewsletterSubscriber_email_key'
      },
      {
        fields: [
          'status'
        ],
        unique: false,
        name: 'NewsletterSubscriber_status_idx'
      }
    ],
    idType: 'int'
  },
  Notification: {
    collection: 'notifications',
    id: 'id',
    autoIncrement: true,
    fields: {
      customerId: {
        type: 'int',
        required: false
      },
      recipientEmail: {
        type: 'string',
        required: true,
        maxLength: 255
      },
      type: {
        type: 'string',
        required: true,
        maxLength: 50
      },
      subject: {
        type: 'string',
        required: true,
        maxLength: 255
      },
      content: {
        type: 'string',
        required: true,
        maxLength: 65535
      },
      status: {
        type: 'string',
        required: true,
        maxLength: 20,
        default: 'pending'
      },
      errorMessage: {
        type: 'string',
        required: false,
        maxLength: 500
      },
      sentAt: {
        type: 'date',
        required: false
      },
      createdAt: {
        type: 'date',
        required: true,
        defaultNow: true
      }
    },
    relations: {
      customer: {
        model: 'Customer',
        many: false,
        local: 'customerId',
        onDelete: 'SetNull'
      }
    },
    indexes: [
      {
        fields: [
          'customerId',
          'createdAt'
        ],
        unique: false,
        name: 'Notification_customerId_createdAt_idx'
      },
      {
        fields: [
          'type'
        ],
        unique: false,
        name: 'Notification_type_idx'
      }
    ],
    idType: 'int'
  },
  PasswordResetToken: {
    collection: 'passwordResetTokens',
    id: 'id',
    autoIncrement: true,
    fields: {
      customerId: {
        type: 'int',
        required: true
      },
      tokenHash: {
        type: 'string',
        required: true,
        maxLength: 64
      },
      expiresAt: {
        type: 'date',
        required: true
      },
      usedAt: {
        type: 'date',
        required: false
      },
      createdAt: {
        type: 'date',
        required: true,
        defaultNow: true
      }
    },
    relations: {
      customer: {
        model: 'Customer',
        many: false,
        local: 'customerId',
        onDelete: 'Cascade'
      }
    },
    indexes: [
      {
        fields: [
          'tokenHash'
        ],
        unique: true,
        name: 'PasswordResetToken_tokenHash_key'
      },
      {
        fields: [
          'customerId'
        ],
        unique: false,
        name: 'PasswordResetToken_customerId_idx'
      }
    ],
    idType: 'int'
  },
  EmailOtp: {
    collection: 'emailOtps',
    id: 'id',
    autoIncrement: true,
    fields: {
      customerId: {
        type: 'int',
        required: true
      },
      purpose: {
        type: 'string',
        required: true,
        maxLength: 20
      },
      challengeHash: {
        type: 'string',
        required: true,
        maxLength: 64
      },
      codeHash: {
        type: 'string',
        required: true,
        maxLength: 64
      },
      attempts: {
        type: 'int',
        required: true,
        default: 0
      },
      sendCount: {
        type: 'int',
        required: true,
        default: 1
      },
      lastSentAt: {
        type: 'date',
        required: true
      },
      expiresAt: {
        type: 'date',
        required: true
      },
      consumedAt: {
        type: 'date',
        required: false
      },
      createdAt: {
        type: 'date',
        required: true,
        defaultNow: true
      }
    },
    relations: {
      customer: {
        model: 'Customer',
        many: false,
        local: 'customerId',
        onDelete: 'Cascade'
      }
    },
    indexes: [
      {
        fields: [
          'challengeHash'
        ],
        unique: true,
        name: 'EmailOtp_challengeHash_key'
      },
      {
        fields: [
          'customerId',
          'purpose'
        ],
        unique: false,
        name: 'EmailOtp_customerId_purpose_idx'
      }
    ],
    idType: 'int'
  },
  SiteStudio: {
    collection: 'siteStudio',
    id: 'id',
    autoIncrement: false,
    fields: {
      draft: {
        type: 'json',
        required: true
      },
      published: {
        type: 'json',
        required: false
      },
      previous: {
        type: 'json',
        required: false
      },
      publishedAt: {
        type: 'date',
        required: false
      },
      updatedBy: {
        type: 'int',
        required: false
      },
      createdAt: {
        type: 'date',
        required: true,
        defaultNow: true
      },
      updatedAt: {
        type: 'date',
        required: true,
        updatedAt: true,
        defaultNow: true
      }
    },
    relations: {},
    indexes: [],
    idType: 'int',
    idDefault: 1
  },
  ContactMessage: {
    collection: 'contactMessages',
    id: 'id',
    autoIncrement: true,
    fields: {
      name: {
        type: 'string',
        required: true,
        maxLength: 120
      },
      email: {
        type: 'string',
        required: true,
        maxLength: 255
      },
      orderReference: {
        type: 'string',
        required: false,
        maxLength: 40
      },
      subject: {
        type: 'string',
        required: true,
        maxLength: 40
      },
      message: {
        type: 'string',
        required: true,
        maxLength: 65535
      },
      status: {
        type: 'string',
        required: true,
        maxLength: 20,
        default: 'new'
      },
      notifyStatus: {
        type: 'string',
        required: true,
        maxLength: 20,
        default: 'pending'
      },
      notifyError: {
        type: 'string',
        required: false,
        maxLength: 500
      },
      createdAt: {
        type: 'date',
        required: true,
        defaultNow: true
      },
      updatedAt: {
        type: 'date',
        required: true,
        updatedAt: true
      }
    },
    relations: {},
    indexes: [
      {
        fields: [
          'status',
          'createdAt'
        ],
        unique: false,
        name: 'ContactMessage_status_createdAt_idx'
      },
      {
        fields: [
          'email'
        ],
        unique: false,
        name: 'ContactMessage_email_idx'
      }
    ],
    idType: 'int'
  },
  WebsiteSetting: {
    collection: 'websiteSettings',
    id: 'id',
    autoIncrement: false,
    fields: {
      siteName: {
        type: 'string',
        required: true,
        maxLength: 120
      },
      logoUrl: {
        type: 'string',
        required: false,
        maxLength: 1024
      },
      faviconUrl: {
        type: 'string',
        required: false,
        maxLength: 1024
      },
      primaryColor: {
        type: 'string',
        required: true,
        maxLength: 7,
        default: '#111111'
      },
      secondaryColor: {
        type: 'string',
        required: true,
        maxLength: 7,
        default: '#f5f5f3'
      },
      accentColor: {
        type: 'string',
        required: true,
        maxLength: 7,
        default: '#111111'
      },
      backgroundColor: {
        type: 'string',
        required: true,
        maxLength: 7,
        default: '#ffffff'
      },
      textColor: {
        type: 'string',
        required: true,
        maxLength: 7,
        default: '#111111'
      },
      headingFont: {
        type: 'string',
        required: true,
        maxLength: 80,
        default: 'Playfair Display'
      },
      bodyFont: {
        type: 'string',
        required: true,
        maxLength: 80,
        default: 'Inter'
      },
      headerLayout: {
        type: 'string',
        required: true,
        maxLength: 40,
        default: 'default'
      },
      footerLayout: {
        type: 'string',
        required: true,
        maxLength: 40,
        default: 'default'
      },
      announcementEnabled: {
        type: 'boolean',
        required: true,
        default: false
      },
      announcementText: {
        type: 'string',
        required: true,
        maxLength: 240,
        default: ''
      },
      announcementLink: {
        type: 'string',
        required: true,
        maxLength: 1024,
        default: ''
      },
      socialLinks: {
        type: 'json',
        required: false
      },
      defaultSeoTitle: {
        type: 'string',
        required: false,
        maxLength: 160
      },
      defaultSeoDescription: {
        type: 'string',
        required: false,
        maxLength: 320
      },
      themeTokens: {
        type: 'json',
        required: false
      },
      updatedBy: {
        type: 'int',
        required: false
      },
      createdAt: {
        type: 'date',
        required: true,
        defaultNow: true
      },
      updatedAt: {
        type: 'date',
        required: true,
        updatedAt: true
      }
    },
    relations: {
      updatedByCustomer: {
        model: 'Customer',
        many: false,
        local: 'updatedBy',
        onDelete: 'SetNull'
      }
    },
    indexes: [
      {
        fields: [
          'updatedBy'
        ],
        unique: false,
        name: 'WebsiteSetting_updatedBy_fkey'
      }
    ],
    idType: 'int',
    idDefault: 1
  },
  CmsPage: {
    collection: 'cmsPages',
    id: 'id',
    autoIncrement: true,
    fields: {
      slug: {
        type: 'string',
        required: true,
        maxLength: 80
      },
      title: {
        type: 'string',
        required: true,
        maxLength: 200
      },
      seoTitle: {
        type: 'string',
        required: false,
        maxLength: 160
      },
      seoDescription: {
        type: 'string',
        required: false,
        maxLength: 320
      },
      status: {
        type: 'string',
        required: true,
        maxLength: 20,
        default: 'draft'
      },
      draftRevisionId: {
        type: 'int',
        required: false
      },
      publishedRevisionId: {
        type: 'int',
        required: false
      },
      createdAt: {
        type: 'date',
        required: true,
        defaultNow: true
      },
      updatedAt: {
        type: 'date',
        required: true,
        updatedAt: true
      }
    },
    relations: {
      revisions: {
        model: 'CmsPageRevision',
        many: true,
        foreign: 'pageId'
      },
      draftRevision: {
        model: 'CmsPageRevision',
        many: false,
        local: 'draftRevisionId',
        onDelete: 'SetNull'
      },
      publishedRevision: {
        model: 'CmsPageRevision',
        many: false,
        local: 'publishedRevisionId',
        onDelete: 'SetNull'
      }
    },
    indexes: [
      {
        fields: [
          'slug'
        ],
        unique: true,
        name: 'CmsPage_slug_key'
      },
      {
        fields: [
          'draftRevisionId'
        ],
        unique: true,
        name: 'CmsPage_draftRevisionId_key'
      },
      {
        fields: [
          'publishedRevisionId'
        ],
        unique: true,
        name: 'CmsPage_publishedRevisionId_key'
      }
    ],
    idType: 'int'
  },
  CmsPageRevision: {
    collection: 'cmsPageRevisions',
    id: 'id',
    autoIncrement: true,
    fields: {
      pageId: {
        type: 'int',
        required: true
      },
      version: {
        type: 'int',
        required: true
      },
      snapshot: {
        type: 'json',
        required: true
      },
      createdBy: {
        type: 'int',
        required: false
      },
      createdAt: {
        type: 'date',
        required: true,
        defaultNow: true
      },
      publishedAt: {
        type: 'date',
        required: false
      },
      note: {
        type: 'string',
        required: false,
        maxLength: 500
      }
    },
    relations: {
      page: {
        model: 'CmsPage',
        many: false,
        local: 'pageId',
        onDelete: 'Cascade'
      },
      author: {
        model: 'Customer',
        many: false,
        local: 'createdBy',
        onDelete: 'SetNull'
      },
      draftFor: {
        model: 'CmsPage',
        many: false,
        foreign: 'draftRevisionId'
      },
      publishedFor: {
        model: 'CmsPage',
        many: false,
        foreign: 'publishedRevisionId'
      }
    },
    indexes: [
      {
        fields: [
          'pageId',
          'version'
        ],
        unique: true,
        name: 'CmsPageRevision_pageId_version_key'
      },
      {
        fields: [
          'pageId',
          'createdAt'
        ],
        unique: false,
        name: 'CmsPageRevision_pageId_createdAt_idx'
      },
      {
        fields: [
          'createdBy'
        ],
        unique: false,
        name: 'CmsPageRevision_createdBy_fkey'
      }
    ],
    idType: 'int'
  },
  MediaAsset: {
    collection: 'mediaAssets',
    id: 'id',
    autoIncrement: true,
    fields: {
      storageKey: {
        type: 'string',
        required: true,
        maxLength: 160
      },
      url: {
        type: 'string',
        required: true,
        maxLength: 255
      },
      mimeType: {
        type: 'string',
        required: true,
        maxLength: 64
      },
      width: {
        type: 'int',
        required: false
      },
      height: {
        type: 'int',
        required: false
      },
      alt: {
        type: 'string',
        required: false,
        maxLength: 200
      },
      sizeBytes: {
        type: 'int',
        required: true,
        min: 0
      },
      createdBy: {
        type: 'int',
        required: false
      },
      createdAt: {
        type: 'date',
        required: true,
        defaultNow: true
      }
    },
    relations: {
      author: {
        model: 'Customer',
        many: false,
        local: 'createdBy',
        onDelete: 'SetNull'
      }
    },
    indexes: [
      {
        fields: [
          'storageKey'
        ],
        unique: true,
        name: 'MediaAsset_storageKey_key'
      },
      {
        fields: [
          'createdBy'
        ],
        unique: false,
        name: 'MediaAsset_createdBy_fkey'
      }
    ],
    idType: 'int'
  },
  Payment: {
    collection: 'payments',
    id: 'id',
    autoIncrement: true,
    fields: {
      orderId: {
        type: 'int',
        required: true
      },
      provider: {
        type: 'string',
        required: true,
        maxLength: 40,
        default: 'razorpay'
      },
      providerOrderId: {
        type: 'string',
        required: false,
        maxLength: 80
      },
      providerPaymentId: {
        type: 'string',
        required: false,
        maxLength: 80
      },
      amountMinor: {
        type: 'int',
        required: true,
        min: 0
      },
      currency: {
        type: 'string',
        required: true,
        maxLength: 3,
        default: 'INR'
      },
      status: {
        type: 'string',
        required: true,
        maxLength: 30,
        default: 'created'
      },
      method: {
        type: 'string',
        required: false,
        maxLength: 40
      },
      failureCode: {
        type: 'string',
        required: false,
        maxLength: 80
      },
      failureDescription: {
        type: 'string',
        required: false,
        maxLength: 500
      },
      capturedAt: {
        type: 'date',
        required: false
      },
      createdAt: {
        type: 'date',
        required: true,
        defaultNow: true
      },
      updatedAt: {
        type: 'date',
        required: true,
        updatedAt: true
      }
    },
    relations: {
      order: {
        model: 'Order',
        many: false,
        local: 'orderId',
        onDelete: 'Restrict'
      },
      events: {
        model: 'PaymentEvent',
        many: true,
        foreign: 'paymentId'
      },
      refunds: {
        model: 'Refund',
        many: true,
        foreign: 'paymentId'
      }
    },
    indexes: [
      {
        fields: [
          'providerOrderId'
        ],
        unique: true,
        name: 'Payment_providerOrderId_key'
      },
      {
        fields: [
          'providerPaymentId'
        ],
        unique: true,
        name: 'Payment_providerPaymentId_key'
      },
      {
        fields: [
          'orderId',
          'createdAt'
        ],
        unique: false,
        name: 'Payment_orderId_createdAt_idx'
      },
      {
        fields: [
          'status'
        ],
        unique: false,
        name: 'Payment_status_idx'
      }
    ],
    idType: 'int'
  },
  PaymentEvent: {
    collection: 'paymentEvents',
    id: 'id',
    autoIncrement: true,
    fields: {
      paymentId: {
        type: 'int',
        required: false
      },
      eventId: {
        type: 'string',
        required: true,
        maxLength: 120
      },
      eventType: {
        type: 'string',
        required: true,
        maxLength: 80
      },
      payload: {
        type: 'string',
        required: true,
        maxLength: 65535
      },
      processedAt: {
        type: 'date',
        required: false
      },
      createdAt: {
        type: 'date',
        required: true,
        defaultNow: true
      }
    },
    relations: {
      payment: {
        model: 'Payment',
        many: false,
        local: 'paymentId',
        onDelete: 'SetNull'
      }
    },
    indexes: [
      {
        fields: [
          'eventId'
        ],
        unique: true,
        name: 'PaymentEvent_eventId_key'
      },
      {
        fields: [
          'paymentId'
        ],
        unique: false,
        name: 'PaymentEvent_paymentId_idx'
      }
    ],
    idType: 'int'
  },
  Refund: {
    collection: 'refunds',
    id: 'id',
    autoIncrement: true,
    fields: {
      paymentId: {
        type: 'int',
        required: true
      },
      providerRefundId: {
        type: 'string',
        required: false,
        maxLength: 80
      },
      amountMinor: {
        type: 'int',
        required: true,
        min: 0
      },
      currency: {
        type: 'string',
        required: true,
        maxLength: 3,
        default: 'INR'
      },
      status: {
        type: 'string',
        required: true,
        maxLength: 30,
        default: 'created'
      },
      reason: {
        type: 'string',
        required: false,
        maxLength: 500
      },
      failureCode: {
        type: 'string',
        required: false,
        maxLength: 80
      },
      failureDescription: {
        type: 'string',
        required: false,
        maxLength: 500
      },
      processedAt: {
        type: 'date',
        required: false
      },
      createdAt: {
        type: 'date',
        required: true,
        defaultNow: true
      },
      updatedAt: {
        type: 'date',
        required: true,
        updatedAt: true
      }
    },
    relations: {
      payment: {
        model: 'Payment',
        many: false,
        local: 'paymentId',
        onDelete: 'Restrict'
      }
    },
    indexes: [
      {
        fields: [
          'providerRefundId'
        ],
        unique: true,
        name: 'Refund_providerRefundId_key'
      },
      {
        fields: [
          'paymentId',
          'createdAt'
        ],
        unique: false,
        name: 'Refund_paymentId_createdAt_idx'
      }
    ],
    idType: 'int'
  }
};
