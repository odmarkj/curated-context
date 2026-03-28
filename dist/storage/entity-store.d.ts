/**
 * Entity / Knowledge Graph (Phase 2.1)
 *
 * Lightweight entity model layered on top of the memory store.
 * Entities represent things (tools, services, dependencies, etc.)
 * with typed relationships between them.
 */
export type EntityType = 'tool' | 'service' | 'dependency' | 'pattern' | 'decision' | 'person' | 'config';
export interface Entity {
    id: string;
    name: string;
    type: EntityType;
    state?: string;
    createdAt: number;
    updatedAt: number;
}
export interface EntityRelationship {
    subjectId: string;
    predicate: string;
    objectId: string;
    confidence: number;
    createdAt: number;
}
/**
 * Create or update an entity, using 4-tier dedup to avoid duplicates.
 */
export declare function upsertEntity(projectRoot: string, name: string, type: EntityType, state?: string): Entity;
/**
 * Create a relationship between two entities.
 */
export declare function addRelationship(projectRoot: string, subjectId: string, predicate: string, objectId: string, confidence?: number): void;
/**
 * Query entities by type.
 */
export declare function getEntitiesByType(projectRoot: string, type: EntityType): Entity[];
/**
 * Query relationships for an entity.
 */
export declare function getRelationships(projectRoot: string, entityId: string): EntityRelationship[];
/**
 * Close all cached entity database connections.
 */
export declare function closeAllEntityDbs(): void;
//# sourceMappingURL=entity-store.d.ts.map