package com.shopsmart.system;

import java.io.IOException;
import java.io.InputStream;
import java.math.BigDecimal;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.shopsmart.common.Json;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Loads seed/catalog.json and demo users into an empty database. Runs once: it does nothing
 * when products already exist.
 */
@Component
@Order(1)
public class DataSeeder implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(DataSeeder.class);

    /** email, name, role, tier, region */
    private static final List<String[]> DEMO_USERS = List.of(
            new String[] {"basic@shopsmart.dev", "Aarav Basic", "CUSTOMER", "BASIC", "IN-WEST"},
            new String[] {"prime@shopsmart.dev", "Priya Prime", "CUSTOMER", "PRIME", "IN-SOUTH"},
            new String[] {"premium@shopsmart.dev", "Kabir Premium", "CUSTOMER", "PREMIUM", "IN-NORTH"},
            new String[] {"admin@shopsmart.dev", "Asha Admin", "ADMIN", "PREMIUM", "IN-WEST"},
            new String[] {"ops@shopsmart.dev", "Omar Ops", "OPS", "BASIC", "IN-WEST"});

    private final JdbcClient jdbc;
    private final ObjectMapper mapper;
    private final Json json;
    private final PasswordEncoder passwordEncoder;
    private final TransactionTemplate tx;
    private final String demoPassword;

    public DataSeeder(JdbcClient jdbc, ObjectMapper mapper, Json json, PasswordEncoder passwordEncoder,
                      TransactionTemplate tx, @Value("${DEMO_USER_PASSWORD:ShopSmart@2026}") String demoPassword) {
        this.jdbc = jdbc;
        this.mapper = mapper;
        this.json = json;
        this.passwordEncoder = passwordEncoder;
        this.tx = tx;
        this.demoPassword = demoPassword;
    }

    @Override
    public void run(ApplicationArguments args) throws IOException {
        long products = jdbc.sql("select count(*) from products").query(Long.class).single();
        if (products > 0) return;

        Catalog catalog;
        try (InputStream in = new ClassPathResource("seed/catalog.json").getInputStream()) {
            catalog = mapper.readValue(in, Catalog.class);
        }
        tx.executeWithoutResult(status -> seed(catalog));
        log.info("Seeded {} products, {} brands, {} warehouses and {} demo users",
                catalog.products().size(), catalog.brands().size(), catalog.warehouses().size(), DEMO_USERS.size());
    }

    private void seed(Catalog catalog) {
        Map<String, Integer> categoryIds = new HashMap<>();
        Map<String, String> categoryPaths = new HashMap<>();
        for (CategorySeed c : catalog.categories()) {
            Integer parentId = c.parent() == null ? null : categoryIds.get(c.parent());
            String path = c.parent() == null ? c.slug() : categoryPaths.get(c.parent()) + "/" + c.slug();
            int id = jdbc.sql("insert into categories (parent_id, slug, name, path, sort_order) values (:p, :s, :n, :path, :o) returning id")
                    .param("p", parentId).param("s", c.slug()).param("n", c.name()).param("path", path).param("o", c.sortOrder())
                    .query(Integer.class).single();
            categoryIds.put(c.slug(), id);
            categoryPaths.put(c.slug(), path);
        }

        Map<String, Integer> brandIds = new HashMap<>();
        for (String brand : catalog.brands()) {
            brandIds.put(brand, jdbc.sql("insert into brands (name) values (:n) returning id").param("n", brand)
                    .query(Integer.class).single());
        }

        for (WarehouseSeed w : catalog.warehouses()) {
            jdbc.sql("insert into warehouses (id, name, city, region) values (:id, :n, :c, :r)")
                    .param("id", w.id()).param("n", w.name()).param("c", w.city()).param("r", w.region()).update();
        }

        for (ProductSeed p : catalog.products()) {
            jdbc.sql("""
                            insert into products (id, name, slug, category_id, brand_id, description, price, mrp, rating, rating_count, images, specs, tags)
                            values (:id, :name, :slug, :cat, :brand, :desc, :price, :mrp, :rating, :rc, cast(:images as jsonb), cast(:specs as jsonb), :tags)
                            """)
                    .param("id", p.id()).param("name", p.name()).param("slug", p.slug())
                    .param("cat", categoryIds.get(p.category())).param("brand", brandIds.get(p.brand()))
                    .param("desc", p.description()).param("price", p.price()).param("mrp", p.mrp())
                    .param("rating", p.rating()).param("rc", p.ratingCount())
                    .param("images", json.write(p.images())).param("specs", json.write(p.specs()))
                    .param("tags", p.tags().toArray(String[]::new))
                    .update();
        }

        for (InventorySeed i : catalog.inventory()) {
            jdbc.sql("insert into inventory (product_id, warehouse_id, on_hand, reorder_point) values (:p, :w, :o, :r)")
                    .param("p", i.productId()).param("w", i.warehouseId()).param("o", i.onHand()).param("r", i.reorderPoint())
                    .update();
        }

        String hash = passwordEncoder.encode(demoPassword);
        for (String[] u : DEMO_USERS) {
            jdbc.sql("""
                            insert into users (email, name, password_hash, role, membership_tier, region)
                            values (:e, :n, :h, :role, :tier, :region) on conflict (email) do nothing
                            """)
                    .param("e", u[0]).param("n", u[1]).param("h", hash).param("role", u[2]).param("tier", u[3]).param("region", u[4])
                    .update();
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record Catalog(List<CategorySeed> categories, List<String> brands, List<WarehouseSeed> warehouses,
                   List<ProductSeed> products, List<InventorySeed> inventory) {
    }

    record CategorySeed(String slug, String name, String parent, int sortOrder) {
    }

    record WarehouseSeed(String id, String name, String city, String region) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record ProductSeed(String id, String name, String slug, String brand, String category, String description,
                       BigDecimal price, BigDecimal mrp, BigDecimal rating, int ratingCount, List<String> images,
                       Map<String, Object> specs, List<String> tags) {
    }

    record InventorySeed(String productId, String warehouseId, int onHand, int reorderPoint) {
    }
}
