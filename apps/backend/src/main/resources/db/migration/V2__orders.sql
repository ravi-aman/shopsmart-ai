-- Order numbering, delivery timestamps and one return request per item.

create sequence order_number_seq start 100001;

alter table orders add column delivered_at timestamptz;
alter table orders add column cancelled_at timestamptz;

alter table return_requests add constraint uq_return_item unique (order_id, product_id);

alter table stock_movements drop constraint stock_movements_reason_check;
alter table stock_movements add constraint stock_movements_reason_check
    check (reason in ('SALE', 'RESTOCK', 'RETURN', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT', 'CANCELLATION'));

create index idx_shipments_delayed on shipments (delayed) where delayed;
