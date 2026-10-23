package com.shopsmart.customer;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
public class UserRepository {

    private static final String SELECT_USER =
            "select id, name, email, password_hash, role, membership_tier, region, created_at from users ";

    private final JdbcClient jdbc;

    public UserRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<UserAccount> findByEmail(String email) {
        return jdbc.sql(SELECT_USER + "where lower(email) = lower(:email)")
                .param("email", email)
                .query(UserAccount.class)
                .optional();
    }

    public Optional<UserAccount> findById(UUID id) {
        return jdbc.sql(SELECT_USER + "where id = :id").param("id", id).query(UserAccount.class).optional();
    }

    public UserAccount insert(String name, String email, String passwordHash, String role, String tier, String region) {
        return jdbc.sql("""
                        insert into users (name, email, password_hash, role, membership_tier, region)
                        values (:name, lower(:email), :hash, :role, :tier, :region)
                        returning id, name, email, password_hash, role, membership_tier, region, created_at
                        """)
                .param("name", name)
                .param("email", email)
                .param("hash", passwordHash)
                .param("role", role)
                .param("tier", tier)
                .param("region", region)
                .query(UserAccount.class)
                .single();
    }

    public Preferences findPreferences(UUID userId) {
        return jdbc.sql("""
                        select preferred_categories, preferred_brands, use_cases, budget_min, budget_max
                        from user_preferences where user_id = :id
                        """)
                .param("id", userId)
                .query((rs, n) -> new Preferences(
                        List.of((String[]) rs.getArray(1).getArray()),
                        List.of((String[]) rs.getArray(2).getArray()),
                        List.of((String[]) rs.getArray(3).getArray()),
                        rs.getBigDecimal(4),
                        rs.getBigDecimal(5)))
                .optional()
                .orElse(Preferences.EMPTY);
    }

    public void upsertPreferences(UUID userId, Preferences p) {
        jdbc.sql("""
                        insert into user_preferences (user_id, preferred_categories, preferred_brands, use_cases, budget_min, budget_max, updated_at)
                        values (:id, :cats, :brands, :uses, :min, :max, now())
                        on conflict (user_id) do update set
                            preferred_categories = excluded.preferred_categories,
                            preferred_brands = excluded.preferred_brands,
                            use_cases = excluded.use_cases,
                            budget_min = excluded.budget_min,
                            budget_max = excluded.budget_max,
                            updated_at = now()
                        """)
                .param("id", userId)
                .param("cats", p.preferredCategories().toArray(String[]::new))
                .param("brands", p.preferredBrands().toArray(String[]::new))
                .param("uses", p.useCases().toArray(String[]::new))
                .param("min", p.budgetMin())
                .param("max", p.budgetMax())
                .update();
    }

    public record Preferences(
            List<String> preferredCategories,
            List<String> preferredBrands,
            List<String> useCases,
            BigDecimal budgetMin,
            BigDecimal budgetMax) {

        static final Preferences EMPTY = new Preferences(List.of(), List.of(), List.of(), null, null);
    }
}
